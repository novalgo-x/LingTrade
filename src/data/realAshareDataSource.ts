import { assertRealDataConfig, type DataProviderConfig } from "../config.js";
import type {
  ConceptTag,
  DailyPrice,
  EarningsForecast,
  FinancialSnapshot,
  HolderTrade,
  InstitutionSurvey,
  MarginDay,
  MoneyFlowDay,
  PeerComparison,
  QuoteData,
  RawStockDataset,
  SentimentInputItem,
  SourceReference,
  TechnicalSnapshot,
  TopInstEntry,
  TopListEntry,
} from "../domain/types.js";
import type { StockDataSource } from "./dataSource.js";
import {
  calculateChangePct,
  calculateMA,
  calculateRSI,
  calculateVolatility,
  determineTrend,
  findResistance,
  findSupport,
} from "./technicalCalc.js";
import { XueqiuDataSource } from "./xueqiuDataSource.js";

type HttpResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<HttpResponseLike>;

type TushareValue = string | number | null;

type TushareResponse = {
  code: number;
  msg?: string;
  // 错误响应（限频、无权限等）中 data 为 null
  data?: {
    fields?: string[];
    items?: TushareValue[][];
  } | null;
};

type TushareRow = Record<string, TushareValue | undefined>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTushareValue(value: unknown): value is TushareValue {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function isTushareResponse(value: unknown): value is TushareResponse {
  if (!isObject(value) || typeof value.code !== "number") return false;
  if (value.data === undefined || value.data === null) return true;
  if (!isObject(value.data)) return false;
  const fields = value.data.fields;
  const items = value.data.items;
  return (
    (fields === undefined || (Array.isArray(fields) && fields.every((field) => typeof field === "string"))) &&
    (items === undefined || (Array.isArray(items) && items.every((item) => Array.isArray(item) && item.every(isTushareValue))))
  );
}

function numeric(value: TushareValue | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function text(value: TushareValue | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

export function normalizeAshareTicker(ticker: string): string {
  const trimmed = ticker.trim().toUpperCase();
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(trimmed)) return trimmed;
  if (!/^\d{6}$/.test(trimmed)) {
    throw new Error(`Invalid A-share ticker: ${ticker}`);
  }
  if (trimmed.startsWith("6")) return `${trimmed}.SH`;
  if (trimmed.startsWith("8") || trimmed.startsWith("4")) return `${trimmed}.BJ`;
  return `${trimmed}.SZ`;
}

export function tickerWithoutSuffix(tsCode: string): string {
  return tsCode.split(".")[0] ?? tsCode;
}

export function exchangeFromTsCode(tsCode: string): QuoteData["exchange"] {
  if (tsCode.endsWith(".SH")) return "SH";
  if (tsCode.endsWith(".SZ")) return "SZ";
  if (tsCode.endsWith(".BJ")) return "BJ";
  return "UNKNOWN";
}

export function mapTushareRows(response: TushareResponse): TushareRow[] {
  const fields = response.data?.fields ?? [];
  const items = response.data?.items ?? [];
  return items.map((item) => {
    const row: TushareRow = {};
    fields.forEach((field, index) => {
      row[field] = item[index];
    });
    return row;
  });
}

// 各接口的中文用途名，用于数据缺失时的友好提示
const TUSHARE_API_LABELS: Record<string, string> = {
  stock_basic: "股票基础信息",
  daily_basic: "每日估值指标",
  fina_indicator: "财务指标",
  income: "利润表",
  cashflow: "现金流量表",
  daily: "日线行情",
  moneyflow: "个股资金流向",
  forecast: "业绩预告",
  stk_holdertrade: "股东增减持",
  top_list: "龙虎榜成交明细",
  top_inst: "龙虎榜机构席位",
  margin_detail: "融资融券明细",
  stk_surv: "机构调研记录",
  concept_detail: "概念板块",
};

function tushareSource(retrievedAt: string): SourceReference {
  return {
    name: "Tushare Pro",
    type: "financials",
    credibility: "high",
    commercialUse: "allowed",
    retrievedAt,
    note: "Fetched through Tushare HTTP API using local environment token.",
  };
}

function aktoolsSource(retrievedAt: string): SourceReference {
  return {
    name: "AKTools/AKShare",
    type: "market_data",
    credibility: "medium",
    commercialUse: "restricted",
    retrievedAt,
    note: "Fetched through user-provided AKTools service; verify license before commercial use.",
  };
}

export class RealAshareDataSource implements StockDataSource {
  readonly name = "real-a-share-data";
  private xueqiu?: XueqiuDataSource;
  private dataGaps: Array<{ api: string; label: string; reason: string }> = [];
  private tushareAttempts = 0;
  private tushareSuccesses = 0;
  // 串行化 Tushare 请求：低积分 token 的调用频次限制很严，并发请求容易集体触发限频
  private requestQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: DataProviderConfig,
    private readonly httpFetch: HttpFetch = fetch,
  ) {
    assertRealDataConfig(config);
    if (config.xueqiuToken) {
      this.xueqiu = new XueqiuDataSource({
        token: config.xueqiuToken,
        timeout: config.requestTimeoutMs,
      });
    }
  }

  async loadStockDataset(ticker: string): Promise<RawStockDataset> {
    const tsCode = normalizeAshareTicker(ticker);
    const retrievedAt = nowIso();
    const today = formatDate(new Date());
    this.dataGaps = [];
    this.tushareAttempts = 0;
    this.tushareSuccesses = 0;

    const stockBasic = await this.fetchTushareFirstSafe(
      "stock_basic",
      { ts_code: tsCode },
      "ts_code,name,area,industry,market,list_date",
    );

    const [
      dailyBasic,
      finaIndicator,
      income,
      cashflow,
      dailyRows,
      moneyFlowRows,
      forecastRows,
      holderTradeRows,
      topListRows,
      topInstRows,
      marginRows,
      surveyRows,
      conceptRows,
      aktoolsQuote,
    ] = await Promise.all([
      this.fetchTushareFirstSafe(
        "daily_basic",
        { ts_code: tsCode },
        "ts_code,trade_date,close,turnover_rate,volume_ratio,pe_ttm,pb,total_mv,dv_ttm",
      ),
      this.fetchTushareFirstSafe(
        "fina_indicator",
        { ts_code: tsCode },
        "ts_code,end_date,roe,grossprofit_margin,netprofit_margin,debt_to_assets,or_yoy,netprofit_yoy,ocfps",
      ),
      this.fetchTushareFirstSafe(
        "income",
        { ts_code: tsCode },
        "ts_code,end_date,total_revenue,n_income_attr_p",
      ),
      this.fetchTushareFirstSafe(
        "cashflow",
        { ts_code: tsCode },
        "ts_code,end_date,n_cashflow_act",
      ),
      this.fetchTushareRowsSafe(
        "daily",
        { ts_code: tsCode, start_date: daysAgo(120), end_date: today },
        "ts_code,trade_date,open,high,low,close,vol,amount,pct_chg",
      ),
      this.fetchTushareRowsSafe(
        "moneyflow",
        { ts_code: tsCode, start_date: daysAgo(45), end_date: today },
        "ts_code,trade_date,buy_sm_amount,sell_sm_amount,buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount,net_mf_amount",
      ),
      this.fetchTushareRowsSafe(
        "forecast",
        { ts_code: tsCode },
        "ts_code,ann_date,end_date,type,p_change_min,p_change_max,net_profit_min,net_profit_max,summary,change_reason",
      ),
      this.fetchTushareRowsSafe(
        "stk_holdertrade",
        { ts_code: tsCode, start_date: daysAgo(180), end_date: today },
        "ts_code,ann_date,holder_name,holder_type,in_de,change_vol,change_ratio,after_ratio,avg_price",
      ),
      this.fetchTushareRowsSafe(
        "top_list",
        { ts_code: tsCode, start_date: daysAgo(90), end_date: today },
        "ts_code,trade_date,name,close,pct_change,amount,l_buy,l_sell,net_amount,reason",
      ),
      this.fetchTushareRowsSafe(
        "top_inst",
        { ts_code: tsCode, start_date: daysAgo(90), end_date: today },
        "ts_code,trade_date,exalter,buy,sell,net_buy,side,reason",
      ),
      this.fetchTushareRowsSafe(
        "margin_detail",
        { ts_code: tsCode, start_date: daysAgo(45), end_date: today },
        "ts_code,trade_date,rzye,rzmre,rqye,rzrqye",
      ),
      this.fetchTushareRowsSafe(
        "stk_surv",
        { ts_code: tsCode, start_date: daysAgo(180), end_date: today },
        "ts_code,surv_date,org_name,org_type,rece_org,content",
      ),
      this.fetchTushareRowsSafe(
        "concept_detail",
        { ts_code: tsCode },
        "ts_code,concept_name,in_date,out_date",
      ),
      this.fetchAktoolsQuote(tsCode),
    ]);

    // token 配置了但所有接口全部失败：大概率是 token 无效或服务不可达，
    // 此时继续分析只会产出全零数据的无效报告，应明确报错
    if (this.tushareAttempts > 0 && this.tushareSuccesses === 0) {
      throw new Error(
        `Tushare 数据全部获取失败（${this.tushareAttempts} 个接口无一成功）。` +
          `请在「设置 → 数据源」中测试连通性，确认 token 有效。首个错误：${this.dataGaps[0]?.reason ?? "未知"}`,
      );
    }
    if (this.dataGaps.length > 0) {
      console.error(`\n⚠ 共 ${this.dataGaps.length} 项 Tushare 数据未获取到（通常为积分权限不足），分析将基于已获取的数据继续。`);
      console.error(`  缺失项：${this.dataGaps.map((gap) => gap.label).join("、")}`);
      console.error(`  各接口的积分要求可在 https://tushare.pro/document/2 查询，提升积分后可获得更完整的分析。\n`);
    }

    const dailyPrices = this.buildDailyPrices(dailyRows);
    const quote = this.buildQuote(tsCode, retrievedAt, stockBasic, dailyBasic, aktoolsQuote);
    const financials = this.buildFinancials(retrievedAt, dailyBasic, finaIndicator, income, cashflow);
    const technicals = this.buildTechnicals(retrievedAt, quote, dailyPrices);
    const peers = this.buildPeers(tsCode, stockBasic, dailyBasic, finaIndicator);
    const sentimentItems = await this.buildSentimentItems(tsCode, quote, financials);

    if (dailyPrices.length > 20) {
      const closes = dailyPrices.map((p) => p.close);
      quote.changePct20d = calculateChangePct(closes, 20);
    }

    return {
      quote,
      financials,
      technicals,
      peers,
      sentimentItems,
      dailyPrices,
      moneyFlow: this.buildMoneyFlow(moneyFlowRows),
      earningsForecasts: this.buildEarningsForecasts(forecastRows),
      holderTrades: this.buildHolderTrades(holderTradeRows),
      topList: this.buildTopList(topListRows),
      topInst: this.buildTopInst(topInstRows),
      margin: this.buildMargin(marginRows),
      institutionSurveys: this.buildInstitutionSurveys(surveyRows),
      concepts: this.buildConcepts(conceptRows),
      dataGaps: this.dataGaps.map((gap) => `${gap.label}（${gap.api}）：${gap.reason}`),
    };
  }

  // ── Tushare transport ─────────────────────────────────────────────

  private async fetchTushareRows(apiName: string, params: Record<string, string>, fields: string): Promise<TushareRow[]> {
    if (!this.config.tushareToken) return [];
    const response = await this.fetchJson(this.config.tushareBaseUrl, {
      api_name: apiName,
      token: this.config.tushareToken,
      params,
      fields,
    });
    if (!isTushareResponse(response)) {
      const snippet = (JSON.stringify(response) ?? String(response)).slice(0, 120);
      throw new Error(`接口返回了无法识别的数据结构（可能是代理服务异常）：${snippet}`);
    }
    if (response.code !== 0) {
      throw new Error(response.msg ?? `错误码 ${response.code}`);
    }
    return mapTushareRows(response);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(task, task);
    this.requestQueue = run.catch(() => undefined);
    return run;
  }

  // 失败不中断：记录数据缺口并打印友好提示，分析基于已获取的数据继续
  private async fetchTushareRowsSafe(apiName: string, params: Record<string, string>, fields: string): Promise<TushareRow[]> {
    if (!this.config.tushareToken) return [];
    this.tushareAttempts += 1;
    try {
      const rows = await this.enqueue(() => this.fetchTushareRows(apiName, params, fields));
      this.tushareSuccesses += 1;
      return rows;
    } catch (error) {
      const label = TUSHARE_API_LABELS[apiName] ?? apiName;
      const reason = error instanceof Error ? error.message : String(error);
      this.dataGaps.push({ api: apiName, label, reason });
      console.error(`⚠ Tushare ${label}（${apiName}）获取失败：${reason}`);
      return [];
    }
  }

  private async fetchTushareFirstSafe(apiName: string, params: Record<string, string>, fields: string): Promise<TushareRow | undefined> {
    const rows = await this.fetchTushareRowsSafe(apiName, params, fields);
    return rows[0];
  }

  private async fetchAktoolsQuote(tsCode: string): Promise<Record<string, unknown> | undefined> {
    if (!this.config.aktoolsBaseUrl) return undefined;
    const endpoint = `${this.config.aktoolsBaseUrl.replace(/\/+$/, "")}/api/public/stock_zh_a_spot_em`;
    const response = await this.fetchJson(endpoint, undefined);
    if (!Array.isArray(response)) return undefined;
    const ticker = tickerWithoutSuffix(tsCode);
    return response.find((item): item is Record<string, unknown> => isObject(item) && Object.values(item).some((value) => String(value) === ticker));
  }

  private async fetchJson(url: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const init =
        body === undefined
          ? { method: "GET", signal: controller.signal }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            };
      const response = await this.httpFetch(url, init);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Build: core data ──────────────────────────────────────────────

  private buildQuote(
    tsCode: string,
    retrievedAt: string,
    stockBasic: TushareRow | undefined,
    dailyBasic: TushareRow | undefined,
    aktoolsQuote: Record<string, unknown> | undefined,
  ): QuoteData {
    const akPrice = typeof aktoolsQuote?.最新价 === "number" ? aktoolsQuote.最新价 : undefined;
    const akChange = typeof aktoolsQuote?.涨跌幅 === "number" ? aktoolsQuote.涨跌幅 : undefined;
    return {
      ticker: tickerWithoutSuffix(tsCode),
      name: text(stockBasic?.name, tickerWithoutSuffix(tsCode)),
      exchange: exchangeFromTsCode(tsCode),
      industry: text(stockBasic?.industry, "unavailable"),
      lastPrice: akPrice ?? numeric(dailyBasic?.close, 0),
      marketCapCny: numeric(dailyBasic?.total_mv, 0) * 10_000,
      changePct1d: akChange ?? 0,
      changePct20d: 0,
      volumeRatio: numeric(dailyBasic?.volume_ratio, 0),
      dataAsOf: retrievedAt,
      sources: [aktoolsQuote ? aktoolsSource(retrievedAt) : tushareSource(retrievedAt)],
    };
  }

  private buildFinancials(
    retrievedAt: string,
    dailyBasic: TushareRow | undefined,
    finaIndicator: TushareRow | undefined,
    income: TushareRow | undefined,
    cashflow: TushareRow | undefined,
  ): FinancialSnapshot {
    const netIncome = numeric(income?.n_income_attr_p, 0);
    const operatingCashFlow = numeric(cashflow?.n_cashflow_act, 0);
    return {
      revenueGrowthYoY: numeric(finaIndicator?.or_yoy, 0),
      netProfitGrowthYoY: numeric(finaIndicator?.netprofit_yoy, 0),
      grossMargin: numeric(finaIndicator?.grossprofit_margin, 0),
      netMargin: numeric(finaIndicator?.netprofit_margin, 0),
      roe: numeric(finaIndicator?.roe, 0),
      operatingCashFlowToNetIncome: netIncome === 0 ? numeric(finaIndicator?.ocfps, 0) : Number((operatingCashFlow / netIncome).toFixed(2)),
      debtToAsset: numeric(finaIndicator?.debt_to_assets, 0),
      peTtm: numeric(dailyBasic?.pe_ttm, 0),
      pb: numeric(dailyBasic?.pb, 0),
      dividendYield: numeric(dailyBasic?.dv_ttm, 0),
      reportingPeriod: text(finaIndicator?.end_date, text(income?.end_date, "unavailable")),
      sources: [tushareSource(retrievedAt)],
    };
  }

  private buildTechnicals(retrievedAt: string, quote: QuoteData, dailyPrices: DailyPrice[]): TechnicalSnapshot {
    if (dailyPrices.length >= 20) {
      const closes = dailyPrices.map((p) => p.close);
      const ma20 = calculateMA(closes, 20);
      const ma60 = calculateMA(closes, 60);
      return {
        trend: determineTrend(closes),
        aboveMa20: ma20 !== null && closes[0]! > ma20,
        aboveMa60: ma60 !== null && closes[0]! > ma60,
        rsi14: calculateRSI(closes, 14),
        volatility20d: calculateVolatility(closes, 20),
        support: findSupport(dailyPrices, 20),
        resistance: findResistance(dailyPrices, 20),
        sources: quote.sources.length > 0 ? quote.sources : [tushareSource(retrievedAt)],
      };
    }
    return {
      trend: quote.changePct1d > 1 ? "uptrend" : quote.changePct1d < -1 ? "downtrend" : "sideways",
      aboveMa20: false,
      aboveMa60: false,
      rsi14: 50,
      volatility20d: 0,
      support: quote.lastPrice > 0 ? Number((quote.lastPrice * 0.95).toFixed(2)) : 0,
      resistance: quote.lastPrice > 0 ? Number((quote.lastPrice * 1.05).toFixed(2)) : 0,
      sources: quote.sources.length > 0 ? quote.sources : [tushareSource(retrievedAt)],
    };
  }

  private buildPeers(tsCode: string, stockBasic: TushareRow | undefined, dailyBasic: TushareRow | undefined, finaIndicator: TushareRow | undefined): PeerComparison[] {
    return [
      {
        peerTicker: tickerWithoutSuffix(tsCode),
        peerName: text(stockBasic?.name, tickerWithoutSuffix(tsCode)),
        peTtm: numeric(dailyBasic?.pe_ttm, 0),
        pb: numeric(dailyBasic?.pb, 0),
        roe: numeric(finaIndicator?.roe, 0),
        revenueGrowthYoY: numeric(finaIndicator?.or_yoy, 0),
      },
    ];
  }

  private async buildSentimentItems(tsCode: string, quote: QuoteData, financials: FinancialSnapshot): Promise<SentimentInputItem[]> {
    const items: SentimentInputItem[] = [];

    const tushareItem: SentimentInputItem = {
      sourceType: "announcement",
      title: `${quote.name} 最新财务指标已从 Tushare 获取`,
      summary: `报告期 ${financials.reportingPeriod}，收入增速 ${financials.revenueGrowthYoY}%，净利润增速 ${financials.netProfitGrowthYoY}%。`,
      publishedAt: quote.dataAsOf,
      engagement: 0,
      source: tushareSource(quote.dataAsOf),
    };
    items.push(tushareItem);

    if (this.xueqiu) {
      try {
        const xueqiuPosts = await this.xueqiu.fetchStockPosts(tickerWithoutSuffix(tsCode), 20);
        items.push(...xueqiuPosts);
      } catch (error) {
        const fallbackItem: SentimentInputItem = {
          sourceType: "social",
          title: "雪球数据获取失败",
          summary: `无法获取 ${quote.name} 的雪球讨论数据: ${error instanceof Error ? error.message : String(error)}`,
          publishedAt: quote.dataAsOf,
          engagement: 0,
          source: {
            name: "Xueqiu",
            type: "social",
            credibility: "medium",
            commercialUse: "restricted",
            retrievedAt: quote.dataAsOf,
            note: "Fetch failed",
          },
        };
        items.push(fallbackItem);
      }
    } else {
      const placeholderItem: SentimentInputItem = {
        sourceType: "news",
        title: `${tickerWithoutSuffix(tsCode)} 实时情绪源未配置`,
        summary: "当前真实模式已接入财务/行情数据；新闻、社交、研报标题和电话会文本需要后续配置 CNINFO/Xueqiu/新闻源。",
        publishedAt: quote.dataAsOf,
        engagement: 0,
        source: tushareSource(quote.dataAsOf),
      };
      items.push(placeholderItem);
    }

    return items;
  }

  // ── Build: new data sources ───────────────────────────────────────

  private buildDailyPrices(rows: TushareRow[]): DailyPrice[] {
    return rows
      .map((row) => ({
        tradeDate: text(row.trade_date, ""),
        open: numeric(row.open, 0),
        high: numeric(row.high, 0),
        low: numeric(row.low, 0),
        close: numeric(row.close, 0),
        volume: numeric(row.vol, 0),
        amount: numeric(row.amount, 0),
        pctChange: numeric(row.pct_chg, 0),
      }))
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  }

  private buildMoneyFlow(rows: TushareRow[]): MoneyFlowDay[] {
    return rows
      .map((row) => ({
        tradeDate: text(row.trade_date, ""),
        buySmAmount: numeric(row.buy_sm_amount, 0),
        sellSmAmount: numeric(row.sell_sm_amount, 0),
        buyLgAmount: numeric(row.buy_lg_amount, 0),
        sellLgAmount: numeric(row.sell_lg_amount, 0),
        buyElgAmount: numeric(row.buy_elg_amount, 0),
        sellElgAmount: numeric(row.sell_elg_amount, 0),
        netMfAmount: numeric(row.net_mf_amount, 0),
      }))
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  }

  private buildEarningsForecasts(rows: TushareRow[]): EarningsForecast[] {
    return rows
      .map((row) => ({
        annDate: text(row.ann_date, ""),
        endDate: text(row.end_date, ""),
        type: text(row.type, ""),
        pChangeMin: numeric(row.p_change_min, 0),
        pChangeMax: numeric(row.p_change_max, 0),
        netProfitMin: numeric(row.net_profit_min, 0),
        netProfitMax: numeric(row.net_profit_max, 0),
        summary: text(row.summary, ""),
        changeReason: text(row.change_reason, ""),
      }))
      .sort((a, b) => b.annDate.localeCompare(a.annDate));
  }

  private buildHolderTrades(rows: TushareRow[]): HolderTrade[] {
    return rows
      .map((row) => ({
        annDate: text(row.ann_date, ""),
        holderName: text(row.holder_name, ""),
        holderType: text(row.holder_type, ""),
        inDe: text(row.in_de, ""),
        changeVol: numeric(row.change_vol, 0),
        changeRatio: numeric(row.change_ratio, 0),
        afterRatio: numeric(row.after_ratio, 0),
        avgPrice: numeric(row.avg_price, 0),
      }))
      .sort((a, b) => b.annDate.localeCompare(a.annDate));
  }

  private buildTopList(rows: TushareRow[]): TopListEntry[] {
    return rows
      .map((row) => ({
        tradeDate: text(row.trade_date, ""),
        name: text(row.name, ""),
        pctChange: numeric(row.pct_change, 0),
        amount: numeric(row.amount, 0),
        buyAmount: numeric(row.l_buy, 0),
        sellAmount: numeric(row.l_sell, 0),
        netAmount: numeric(row.net_amount, 0),
        reason: text(row.reason, ""),
      }))
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  }

  private buildTopInst(rows: TushareRow[]): TopInstEntry[] {
    return rows
      .map((row) => ({
        tradeDate: text(row.trade_date, ""),
        exalter: text(row.exalter, ""),
        buy: numeric(row.buy, 0),
        sell: numeric(row.sell, 0),
        netBuy: numeric(row.net_buy, 0),
        side: text(row.side, ""),
        reason: text(row.reason, ""),
      }))
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  }

  private buildMargin(rows: TushareRow[]): MarginDay[] {
    return rows
      .map((row) => ({
        tradeDate: text(row.trade_date, ""),
        rzye: numeric(row.rzye, 0),
        rzmre: numeric(row.rzmre, 0),
        rqye: numeric(row.rqye, 0),
        rzrqye: numeric(row.rzrqye, 0),
      }))
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  }

  private buildInstitutionSurveys(rows: TushareRow[]): InstitutionSurvey[] {
    return rows
      .map((row) => ({
        survDate: text(row.surv_date, ""),
        orgName: text(row.org_name, ""),
        orgType: text(row.org_type, ""),
        receOrg: text(row.rece_org, ""),
        content: text(row.content, ""),
      }))
      .sort((a, b) => b.survDate.localeCompare(a.survDate));
  }

  private buildConcepts(rows: TushareRow[]): ConceptTag[] {
    return rows
      .map((row) => ({ conceptName: text(row.concept_name, "") }))
      .filter((c) => c.conceptName.length > 0);
  }
}
