import type { StockDataSource } from "../data/dataSource.js";
import type {
  DebateCase,
  EventType,
  InvestmentDecision,
  InvestmentReport,
  KnowledgeInsight,
  RawStockDataset,
  SentimentReport,
  SourceReference,
  StockAnalysis,
  WorkflowResult,
} from "../domain/types.js";
import { digestKnowledgeBase } from "../knowledge/knowledgeBase.js";
import type { LlmProvider } from "../llm/llmProvider.js";
import type { InstitutionSurvey } from "../domain/types.js";
import { PromptBuilder } from "../prompts/promptBuilder.js";
import {
  STAGE_ORDER,
  applyStageResult,
  stageIndex,
  WorkflowAbortError,
  type StageEmitter,
  type StageId,
  type WorkflowContext,
} from "./stageEvents.js";

const MAX_SURVEY_SESSIONS = 8;

function mergeSurveys(surveys: InstitutionSurvey[]): InstitutionSurvey[] {
  const sessions = new Map<string, { survey: InstitutionSurvey; orgs: Set<string> }>();
  for (const s of surveys) {
    const key = `${s.survDate}:${s.content.slice(0, 200)}`;
    const existing = sessions.get(key);
    if (existing) {
      if (s.receOrg) existing.orgs.add(s.receOrg);
    } else {
      sessions.set(key, { survey: s, orgs: new Set(s.receOrg ? [s.receOrg] : []) });
    }
  }
  return [...sessions.values()]
    .sort((a, b) => b.survey.survDate.localeCompare(a.survey.survDate))
    .slice(0, MAX_SURVEY_SESSIONS)
    .map(({ survey, orgs }) => ({
      ...survey,
      receOrg: [...orgs].join("、"),
    }));
}

function trimForPrompt(dataset: RawStockDataset): Omit<RawStockDataset, "dailyPrices"> {
  const { dailyPrices: _, ...rest } = dataset;
  return {
    ...rest,
    institutionSurveys: mergeSurveys(rest.institutionSurveys),
    sentimentItems: rest.sentimentItems.slice(0, 30),
    moneyFlow: rest.moneyFlow.slice(0, 10),
    margin: rest.margin.slice(0, 10),
    earningsForecasts: rest.earningsForecasts.slice(0, 5),
  };
}

function uniqueSources(sources: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.name}:${source.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSources(dataset: RawStockDataset): SourceReference[] {
  return uniqueSources([
    ...dataset.quote.sources,
    ...dataset.financials.sources,
    ...dataset.technicals.sources,
    ...dataset.sentimentItems.map((item) => item.source),
  ]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inferEventTypes(dataset: RawStockDataset): EventType[] {
  const mapped = dataset.sentimentItems.map<EventType>((item) => {
    if (item.sourceType === "announcement") return "announcement";
    if (item.sourceType === "research_title") return "analyst_report";
    if (item.sourceType === "social") return "social_discussion";
    if (item.sourceType === "earnings_call") return "earnings";
    if (item.sourceType === "news") return "unknown";
    return "unknown";
  });
  return [...new Set(mapped)];
}

function fmtYi(value: number): string {
  return (value / 100_000_000).toFixed(2);
}

export type ProgressCallback = (step: string, result: unknown) => void;

export class InvestmentWorkflow {
  private readonly prompts = new PromptBuilder();
  private readonly onProgress: ProgressCallback | undefined;
  private readonly knowledgeBaseDir: string | undefined;
  private readonly preloadedInsights: KnowledgeInsight[] | undefined;
  /** 当前 runStaged 运行期间的事件发射器与取消信号（每次运行单实例，故可作实例态）。 */
  private emit: StageEmitter | undefined;
  private signal: AbortSignal | undefined;

  constructor(
    private readonly dataSource: StockDataSource,
    private readonly llm: LlmProvider,
    onProgress?: ProgressCallback,
    knowledgeBaseDir?: string,
    preloadedInsights?: KnowledgeInsight[],
  ) {
    this.onProgress = onProgress;
    this.knowledgeBaseDir = knowledgeBaseDir;
    this.preloadedInsights = preloadedInsights;
  }

  /** 兼容旧调用方：用结构化执行器跑完整流程，并把事件桥接回旧的 onProgress 回调。 */
  async run(ticker: string): Promise<WorkflowResult> {
    const emit: StageEmitter = (ev) => {
      if (ev.kind === "stage_done") this.onProgress?.(ev.stage, ev.payload);
      else if (ev.kind === "substep") this.onProgress?.("knowledge_progress", ev.text);
    };
    return this.runStaged({ ticker, emit });
  }

  /**
   * 阶段表驱动的执行器：逐阶段发出结构化事件，支持外部取消与从中间阶段续跑。
   * resumeCtx 提供已完成阶段的结果，fromStage 指定从哪个阶段开始（默认从头）。
   */
  async runStaged(opts: {
    ticker: string;
    emit: StageEmitter;
    signal?: AbortSignal;
    resumeCtx?: WorkflowContext;
    fromStage?: StageId;
  }): Promise<WorkflowResult> {
    const { ticker, emit, signal, resumeCtx, fromStage } = opts;
    this.emit = emit;
    this.signal = signal;
    const ctx: WorkflowContext = { ...(resumeCtx ?? {}) };
    const startIdx = fromStage ? stageIndex(fromStage) : 0;

    try {
      for (let i = startIdx; i < STAGE_ORDER.length; i++) {
        const stage = STAGE_ORDER[i]!;
        this.throwIfAborted();
        emit({ kind: "stage_start", stage, index: i, at: new Date().toISOString() });
        const t0 = Date.now();
        try {
          const { summary, payload, skipped } = await this.executeStage(stage, ticker, ctx);
          if (payload !== undefined) applyStageResult(ctx, stage, payload);
          emit({ kind: "stage_done", stage, index: i, summary, durationMs: Date.now() - t0, skipped, payload, at: new Date().toISOString() });
        } catch (err) {
          const aborted = this.signal?.aborted;
          const message = aborted ? "分析已取消" : err instanceof Error ? err.message : String(err);
          emit({ kind: "stage_failed", stage, index: i, error: message, durationMs: Date.now() - t0, at: new Date().toISOString() });
          if (aborted) throw new WorkflowAbortError(message);
          throw err;
        }
      }
    } finally {
      this.emit = undefined;
      this.signal = undefined;
    }

    return {
      knowledgeInsights: ctx.knowledgeInsights ?? [],
      analysis: ctx.analysis!,
      sentiment: ctx.sentiment!,
      report: ctx.report!,
      bullCase: ctx.bullCase!,
      bearCase: ctx.bearCase!,
      decision: ctx.decision!,
    };
  }

  private async executeStage(
    stage: StageId,
    ticker: string,
    ctx: WorkflowContext,
  ): Promise<{ summary: string; payload?: unknown; skipped?: boolean }> {
    switch (stage) {
      case "data_loaded": {
        const dataset = await this.dataSource.loadStockDataset(ticker, this.signal);
        if (dataset.dataGaps && dataset.dataGaps.length > 0) {
          this.emitSubstep(stage, `数据盲区：${dataset.dataGaps.slice(0, 3).join("、")}`);
        }
        return {
          payload: dataset,
          summary: `已加载 ${dataset.quote.name}（${dataset.quote.ticker}）行情/财务/技术面/资金流/舆情，截至 ${dataset.quote.dataAsOf}`,
        };
      }
      case "knowledge_loaded": {
        const all = await this.loadKnowledge();
        if (all.length === 0) {
          return { payload: [], skipped: true, summary: "未配置相关知识库文档，跳过" };
        }
        const relevant = await this.filterRelevantInsights(ctx.dataset!, all);
        return { payload: relevant, summary: `知识库 ${all.length} 篇中 ${relevant.length} 篇相关` };
      }
      case "analysis_complete": {
        const analysis = await this.analyzeStock(ctx.dataset!, ctx.knowledgeInsights ?? []);
        return {
          payload: analysis,
          summary: analysis.companyOverview ? `${analysis.companyOverview.slice(0, 70)}…` : "基本面分析完成",
        };
      }
      case "sentiment_complete": {
        const sentiment = await this.analyzeSentiment(ctx.dataset!);
        return {
          payload: sentiment,
          summary: `情绪分数 ${sentiment.sentimentScore} · ${(sentiment.summary ?? "").slice(0, 40)}…`,
        };
      }
      case "report_complete": {
        const report = await this.generateReport(ctx.dataset!, ctx.analysis!, ctx.sentiment!, ctx.knowledgeInsights ?? []);
        return {
          payload: report,
          summary: report.investmentSummary ? `${report.investmentSummary.slice(0, 70)}…` : "研报生成完成",
        };
      }
      case "debate_complete": {
        const [bullCase, bearCase] = await Promise.all([
          this.debateBull(ctx.dataset!, ctx.analysis!, ctx.sentiment!, ctx.report!, ctx.knowledgeInsights ?? [])
            .then((c) => { this.emitDebateArgs("bull", c); return c; }),
          this.debateBear(ctx.dataset!, ctx.analysis!, ctx.sentiment!, ctx.report!, ctx.knowledgeInsights ?? [])
            .then((c) => { this.emitDebateArgs("bear", c); return c; }),
        ]);
        return {
          payload: { bullCase, bearCase },
          summary: `多方置信 ${bullCase.conviction} · 空方置信 ${bearCase.conviction}`,
        };
      }
      case "decision_complete": {
        const decision = await this.makeDecision(
          ctx.dataset!, ctx.analysis!, ctx.sentiment!, ctx.report!, ctx.bullCase!, ctx.bearCase!, ctx.knowledgeInsights ?? [],
        );
        return {
          payload: decision,
          summary: `${decision.action.toUpperCase()} · 目标价 ${decision.targetPrice} · 置信 ${decision.confidence}`,
        };
      }
    }
  }

  private emitSubstep(stage: StageId, text: string, side?: "bull" | "bear"): void {
    this.emit?.({ kind: "substep", stage, text, side, at: new Date().toISOString() });
  }

  private emitDebateArgs(side: "bull" | "bear", c: DebateCase): void {
    for (const arg of c.coreArguments.slice(0, 3)) {
      this.emitSubstep("debate_complete", arg, side);
    }
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw new WorkflowAbortError();
  }

  private async loadKnowledge(): Promise<KnowledgeInsight[]> {
    if (this.preloadedInsights && this.preloadedInsights.length > 0) return this.preloadedInsights;
    if (!this.knowledgeBaseDir) return [];
    try {
      return await digestKnowledgeBase(
        this.knowledgeBaseDir,
        this.llm,
        (msg) => this.emitSubstep("knowledge_loaded", msg),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[warn] 知识库加载失败: ${msg}`);
      return [];
    }
  }

  private async filterRelevantInsights(dataset: RawStockDataset, insights: KnowledgeInsight[]): Promise<KnowledgeInsight[]> {
    if (insights.length === 0) return insights;
    this.emitSubstep("knowledge_loaded", `正在筛选与 ${dataset.quote.name} 相关的知识库文档 (${insights.length} 篇)...`);

    const candidates = insights.map((ins, idx) => ({
      idx,
      title: ins.title,
      summary: (ins.summary ?? "").slice(0, 200),
      themes: (ins.investmentThemes ?? []).join(", "),
      sectors: (ins.sectorViews ?? []).slice(0, 3).join(", "),
      stocks: (ins.stockMentions ?? []).slice(0, 5).join(", "),
    }));

    const stockContext = {
      ticker: dataset.quote.ticker,
      name: dataset.quote.name,
      industry: dataset.quote.industry,
      concepts: dataset.concepts.slice(0, 5).map(c => c.conceptName),
    };

    const systemPrompt = `你是一个投研知识库相关性判断助手。给定一只待分析的股票信息和多篇知识库文档摘要，判断哪些文档与该股票的投研分析相关。

相关性判断标准：
1. 直接提及该股票或同行业/同板块公司
2. 覆盖该股票所属行业或概念板块
3. 涉及影响该股票的宏观政策、市场趋势
4. 提供通用投资方法论或框架（对所有股票都有参考价值）

返回严格 JSON：{ "relevant": [0, 2, 5] }
其中数组元素是相关文档的 idx 编号。如果没有相关文档，返回 { "relevant": [] }。
宁可多选也不要漏掉可能相关的文档。`;

    const userPrompt = JSON.stringify({ stock: stockContext, documents: candidates }, null, 2);

    const fallback = { relevant: insights.map((_, i) => i) };

    try {
      const result = await this.llm.generateStructured<{ relevant: number[] }>(
        { task: "knowledge_relevance_filter", systemPrompt, userPrompt, signal: this.signal },
        fallback,
      );
      const indices = new Set(result.relevant);
      const filtered = insights.filter((_, i) => indices.has(i));
      this.emitSubstep("knowledge_loaded", `筛选完成: ${insights.length} 篇中 ${filtered.length} 篇相关`);
      // 尊重模型的相关性判断：判定全部不相关就返回空，不再"保险起见"把不相关文档塞回去
      return filtered;
    } catch (err) {
      console.error(`[warn] 知识库相关性筛选失败，使用全部文档: ${err instanceof Error ? err.message : String(err)}`);
      return insights;
    }
  }

  private async analyzeStock(dataset: RawStockDataset, knowledgeInsights: KnowledgeInsight[]): Promise<StockAnalysis> {
    const sources = collectSources(dataset);

    let overview = `${dataset.quote.name}（${dataset.quote.ticker}）属于${dataset.quote.industry}行业，当前市值约${Math.round(dataset.quote.marketCapCny / 100_000_000)}亿元。`;
    if (dataset.concepts.length > 0) {
      overview += `所属概念板块：${dataset.concepts.map((c) => c.conceptName).join("、")}。`;
    }

    let growth = `收入同比增长 ${dataset.financials.revenueGrowthYoY}%，净利润同比增长 ${dataset.financials.netProfitGrowthYoY}%。`;
    if (dataset.earningsForecasts.length > 0) {
      const latest = dataset.earningsForecasts[0]!;
      growth += `最新业绩预告（${latest.endDate}）：${latest.type}，预计变动 ${latest.pChangeMin}%~${latest.pChangeMax}%。`;
    }

    const fallback: StockAnalysis = {
      ticker: dataset.quote.ticker,
      companyOverview: overview,
      financialQuality: `ROE ${dataset.financials.roe}%、资产负债率 ${dataset.financials.debtToAsset}%，财务质量偏稳健。`,
      growth,
      profitability: `毛利率 ${dataset.financials.grossMargin}%，净利率 ${dataset.financials.netMargin}%，盈利能力高于多数同业。`,
      cashFlow: `经营现金流/净利润为 ${dataset.financials.operatingCashFlowToNetIncome}，现金利润匹配度较好。`,
      valuation: `PE(TTM) ${dataset.financials.peTtm}x，PB ${dataset.financials.pb}x，股息率 ${dataset.financials.dividendYield}%。`,
      technicals: `${dataset.technicals.trend}，20日涨跌幅 ${dataset.quote.changePct20d}%，RSI14 为 ${dataset.technicals.rsi14}。`,
      industryComparison: "相对样本同业，ROE 与利润率更强，但估值也处于溢价区间。",
      risks: ["宏观消费疲弱", "渠道库存波动", "估值溢价收缩", "数据源为 MVP/mock 时需用正式数据复核"],
      dataAsOf: dataset.quote.dataAsOf,
      sources,
    };

    const promptData = trimForPrompt(dataset);
    const prompt = this.prompts.stockAnalysis({ ...promptData, knowledgeInsights }, fallback);
    return this.llm.generateStructured({ task: "stock_analysis", ...prompt, signal: this.signal }, fallback);
  }

  private async analyzeSentiment(dataset: RawStockDataset): Promise<SentimentReport> {
    const sources = uniqueSources(dataset.sentimentItems.map((item) => item.source));
    const totalEngagement = dataset.sentimentItems.reduce((sum, item) => sum + item.engagement, 0);
    const score = clamp((dataset.quote.changePct20d / 20 + dataset.financials.netProfitGrowthYoY / 100) / 2, -1, 1);

    const topSignals = dataset.sentimentItems.map((item) => `${item.sourceType}: ${item.title}`);

    if (dataset.moneyFlow.length > 0) {
      const net5d = dataset.moneyFlow.slice(0, 5).reduce((s, m) => s + m.netMfAmount, 0);
      topSignals.push(`资金流向: 近5日主力净流入 ${fmtYi(net5d)}亿`);
    }
    if (dataset.margin.length >= 2) {
      const latest = dataset.margin[0]!;
      const oldest = dataset.margin[dataset.margin.length - 1]!;
      if (oldest.rzrqye > 0) {
        const pctChange = ((latest.rzrqye - oldest.rzrqye) / oldest.rzrqye * 100).toFixed(1);
        topSignals.push(`融资融券: 融资融券余额 ${fmtYi(latest.rzrqye)}亿，期间变动 ${pctChange}%`);
      }
    }
    if (dataset.topList.length > 0) {
      const netTotal = dataset.topList.reduce((s, t) => s + t.netAmount, 0);
      topSignals.push(`龙虎榜: 近3月上榜 ${dataset.topList.length} 次，机构净买入 ${fmtYi(netTotal)}亿`);
    }
    if (dataset.holderTrades.length > 0) {
      const increases = dataset.holderTrades.filter((h) => h.inDe === "IN");
      const decreases = dataset.holderTrades.filter((h) => h.inDe === "DE");
      topSignals.push(`增减持: 近半年增持 ${increases.length} 笔、减持 ${decreases.length} 笔`);
    }

    const fallback: SentimentReport = {
      ticker: dataset.quote.ticker,
      sentimentScore: Number(score.toFixed(2)),
      heatChange: Number(clamp(totalEngagement / 100, -100, 100).toFixed(1)),
      disagreement: 0.34,
      eventTypes: inferEventTypes(dataset),
      summary: "公告和研报标题偏正面，社交讨论热度上升，但估值分歧仍然存在。",
      topSignals,
      dataAsOf: dataset.quote.dataAsOf,
      sources,
    };

    const sentimentInput = {
      sentimentItems: dataset.sentimentItems,
      moneyFlow: dataset.moneyFlow,
      topList: dataset.topList,
      topInst: dataset.topInst,
      margin: dataset.margin,
      holderTrades: dataset.holderTrades,
    };
    const prompt = this.prompts.sentiment(sentimentInput, fallback);
    return this.llm.generateStructured({ task: "sentiment", ...prompt, signal: this.signal }, fallback);
  }

  private async generateReport(
    dataset: RawStockDataset,
    analysis: StockAnalysis,
    sentiment: SentimentReport,
    knowledgeInsights: KnowledgeInsight[],
  ): Promise<InvestmentReport> {
    const currentPrice = dataset.quote.lastPrice;

    let investmentSummary = "公司基本面稳健、盈利质量较高，短期情绪偏正面；估值处于溢价区间，需要以增长确定性和分红能力消化。";
    if (dataset.earningsForecasts.length > 0) {
      const f = dataset.earningsForecasts[0]!;
      investmentSummary += `最新业绩预告显示${f.type}，预计变动幅度 ${f.pChangeMin}%~${f.pChangeMax}%。`;
    }

    const catalysts = ["季度业绩超预期", "分红政策强化", "消费需求修复", "渠道库存改善"];
    if (dataset.institutionSurveys.length > 0) {
      catalysts.push(`近半年 ${dataset.institutionSurveys.length} 家机构调研，关注度较高`);
    }

    const fallback: InvestmentReport = {
      ticker: dataset.quote.ticker,
      investmentSummary,
      coreThesis: ["高 ROE 与强现金流支撑质量溢价", "收入和利润维持双位数增长", "市场情绪改善但估值分歧未消失"],
      financialAnalysis: `${analysis.financialQuality} ${analysis.growth} ${analysis.cashFlow}`,
      valuationRange: {
        low: Number((currentPrice * 0.9).toFixed(2)),
        base: Number((currentPrice * 1.08).toFixed(2)),
        high: Number((currentPrice * 1.2).toFixed(2)),
        currency: "CNY",
        method: "MVP relative valuation using current price, PE premium, growth, and sentiment adjustment",
      },
      catalysts,
      risks: analysis.risks,
      bearCase: "若宏观消费恢复不及预期或行业估值中枢下移，当前估值溢价可能压缩。",
      dataSources: uniqueSources([...analysis.sources, ...(Array.isArray(sentiment.sources) ? sentiment.sources : [])]),
    };

    const promptData = trimForPrompt(dataset);
    const prompt = this.prompts.report({ dataset: promptData, analysis, sentiment, knowledgeInsights }, fallback);
    return this.llm.generateStructured({ task: "research_report", ...prompt, signal: this.signal }, fallback);
  }

  private async debateBull(
    dataset: RawStockDataset,
    analysis: StockAnalysis,
    sentiment: SentimentReport,
    report: InvestmentReport,
    knowledgeInsights: KnowledgeInsight[],
  ): Promise<DebateCase> {
    const sources = collectSources(dataset);
    const fallback: DebateCase = {
      ticker: dataset.quote.ticker,
      side: "bull",
      coreArguments: [
        `ROE 达 ${dataset.financials.roe}%，盈利能力处于行业领先水平`,
        `净利润同比增长 ${dataset.financials.netProfitGrowthYoY}%，成长性保持韧性`,
        `经营现金流/净利润为 ${dataset.financials.operatingCashFlowToNetIncome}，利润含金量高`,
      ],
      evidencePoints: [
        `毛利率 ${dataset.financials.grossMargin}%，净利率 ${dataset.financials.netMargin}%`,
        `资产负债率仅 ${dataset.financials.debtToAsset}%，财务结构安全`,
        `股息率 ${dataset.financials.dividendYield}%，有分红吸引力`,
      ],
      rebuttals: [
        `估值看似偏高（PE ${dataset.financials.peTtm}x），但高 ROE 和确定性溢价可消化`,
        "短期情绪波动不改变公司长期竞争优势和盈利结构",
      ],
      concessions: ["当前估值确实高于行业均值，需要持续的增长兑现来支撑"],
      conviction: 0.65,
      summary: `${dataset.quote.name}基本面扎实，盈利能力和现金流质量均处于行业前列，成长性可持续，虽然估值偏高但可由确定性溢价消化。`,
      sources,
    };

    const promptData = trimForPrompt(dataset);
    const prompt = this.prompts.bull({ dataset: promptData, analysis, sentiment, report, knowledgeInsights }, fallback);
    return this.llm.generateStructured({ task: "bull_debate", ...prompt, signal: this.signal }, fallback);
  }

  private async debateBear(
    dataset: RawStockDataset,
    analysis: StockAnalysis,
    sentiment: SentimentReport,
    report: InvestmentReport,
    knowledgeInsights: KnowledgeInsight[],
  ): Promise<DebateCase> {
    const sources = collectSources(dataset);
    const bearArguments = [
      `PE(TTM) ${dataset.financials.peTtm}x，估值溢价明显，安全边际不足`,
      "宏观消费环境存在不确定性，增速放缓风险不可忽视",
    ];
    if (dataset.financials.netProfitGrowthYoY < dataset.financials.revenueGrowthYoY) {
      bearArguments.push("利润增速低于收入增速，盈利增长效率存在压力");
    } else {
      bearArguments.push("行业竞争加剧可能侵蚀盈利能力");
    }

    const fallback: DebateCase = {
      ticker: dataset.quote.ticker,
      side: "bear",
      coreArguments: bearArguments,
      evidencePoints: [
        `PE ${dataset.financials.peTtm}x 远高于同业均值`,
        `20日涨跌幅 ${dataset.quote.changePct20d}%，短期波动不容忽视`,
      ],
      rebuttals: [
        "多方强调的高 ROE 部分来自行业特性而非管理能力，不应给予过高溢价",
        "现金流虽好，但估值已充分反映，上行空间有限",
      ],
      concessions: [`公司盈利能力确实出色，ROE ${dataset.financials.roe}% 在同业中领先`],
      conviction: 0.55,
      summary: `${dataset.quote.name}估值偏高且安全边际不足，宏观不确定性和行业竞争可能压制回报，当前价位风险收益比不理想。`,
      sources,
    };

    const promptData = trimForPrompt(dataset);
    const prompt = this.prompts.bear({ dataset: promptData, analysis, sentiment, report, knowledgeInsights }, fallback);
    return this.llm.generateStructured({ task: "bear_debate", ...prompt, signal: this.signal }, fallback);
  }

  private async makeDecision(
    dataset: RawStockDataset,
    analysis: StockAnalysis,
    sentiment: SentimentReport,
    report: InvestmentReport,
    bullCase: DebateCase,
    bearCase: DebateCase,
    knowledgeInsights: KnowledgeInsight[],
  ): Promise<InvestmentDecision> {
    const upside = (report.valuationRange.base - dataset.quote.lastPrice) / dataset.quote.lastPrice;
    const bullStronger = bullCase.conviction > bearCase.conviction;
    const action = bullStronger && upside > 0.12 && sentiment.sentimentScore > 0.1 ? "buy" : !bullStronger && upside < -0.08 ? "sell" : "hold";

    const rationale = [
      `多方置信度 ${bullCase.conviction}，空方置信度 ${bearCase.conviction}`,
      ...bullCase.coreArguments.slice(0, 2),
      sentiment.summary,
      `基准估值隐含 ${(upside * 100).toFixed(1)}% 上行空间`,
    ];
    if (dataset.moneyFlow.length > 0) {
      const netAll = dataset.moneyFlow.reduce((s, m) => s + m.netMfAmount, 0);
      rationale.push(`近期主力资金净流入 ${fmtYi(netAll)}亿`);
    }

    const riskWarnings = [...report.risks];
    const decreases = dataset.holderTrades.filter((h) => h.inDe === "DE");
    if (decreases.length > 0) {
      riskWarnings.push(`近半年存在 ${decreases.length} 笔股东减持记录`);
    }

    const counterArguments = bearCase.coreArguments.slice(0, 3);
    if (counterArguments.length < 2) {
      counterArguments.push(report.bearCase);
    }

    const fallback: InvestmentDecision = {
      ticker: dataset.quote.ticker,
      action,
      confidence: action === "hold" ? 0.52 : 0.6,
      targetPrice: report.valuationRange.base,
      timeHorizon: "6-12 months",
      rationale,
      riskWarnings,
      counterArguments,
      assumptions: ["财务数据真实且已更新至最近报告期", "估值中枢维持稳定", "多空辩论已充分暴露正反方论点"],
      suitability: "仅适合投研辅助和候选标的筛选，不构成个性化投资建议。",
      generatedAt: new Date().toISOString(),
      sources: uniqueSources([...report.dataSources, ...analysis.sources, ...(Array.isArray(sentiment.sources) ? sentiment.sources : [])]),
    };

    const promptData = trimForPrompt(dataset);
    const prompt = this.prompts.decision({ dataset: promptData, analysis, sentiment, report, bullCase, bearCase, knowledgeInsights }, fallback);
    return this.llm.generateStructured({ task: "decision", ...prompt, signal: this.signal }, fallback);
  }
}
