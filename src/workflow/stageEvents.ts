import type {
  DebateCase,
  InvestmentDecision,
  InvestmentReport,
  KnowledgeInsight,
  RawStockDataset,
  SentimentReport,
  StockAnalysis,
  WorkflowResult,
} from "../domain/types.js";

/** 投研流水线的固定阶段顺序（与设计稿 GEN_STAGES 对应）。 */
export const STAGE_ORDER = [
  "data_loaded",
  "knowledge_loaded",
  "analysis_complete",
  "sentiment_complete",
  "report_complete",
  "debate_complete",
  "decision_complete",
] as const;

export type StageId = (typeof STAGE_ORDER)[number];

export function stageIndex(stage: StageId): number {
  return STAGE_ORDER.indexOf(stage);
}

/** 流水线运行过程中累积的中间结果，既是各阶段的输入，也是续跑时复用的缓存。 */
export interface WorkflowContext {
  dataset?: RawStockDataset;
  knowledgeInsights?: KnowledgeInsight[];
  analysis?: StockAnalysis;
  sentiment?: SentimentReport;
  report?: InvestmentReport;
  bullCase?: DebateCase;
  bearCase?: DebateCase;
  decision?: InvestmentDecision;
}

/** 流水线对外发出的结构化事件。 */
export type StageEvent =
  | { kind: "stage_start"; stage: StageId; index: number; at: string }
  | { kind: "substep"; stage: StageId; text: string; side?: "bull" | "bear" | undefined; at: string }
  | {
      kind: "stage_done";
      stage: StageId;
      index: number;
      summary: string;
      durationMs: number;
      skipped?: boolean | undefined;
      /** 该阶段产出的结果对象，供持久化与续跑复用（debate 阶段为 { bullCase, bearCase }）。 */
      payload?: unknown;
      at: string;
    }
  | { kind: "stage_failed"; stage: StageId; index: number; error: string; durationMs: number; at: string };

export type StageEmitter = (event: StageEvent) => void;

/** 用户取消（区别于真实失败）。 */
export class WorkflowAbortError extends Error {
  constructor(message = "分析已取消") {
    super(message);
    this.name = "WorkflowAbortError";
  }
}

/**
 * 把某个已完成阶段的 payload 写回 ctx，用于从持久化结果重建续跑上下文。
 * 与执行器产出 payload 的方式一一对应。
 */
export function applyStageResult(ctx: WorkflowContext, stage: StageId, payload: unknown): void {
  switch (stage) {
    case "data_loaded":
      ctx.dataset = payload as RawStockDataset;
      break;
    case "knowledge_loaded":
      ctx.knowledgeInsights = (payload as KnowledgeInsight[]) ?? [];
      break;
    case "analysis_complete":
      ctx.analysis = payload as StockAnalysis;
      break;
    case "sentiment_complete":
      ctx.sentiment = payload as SentimentReport;
      break;
    case "report_complete":
      ctx.report = payload as InvestmentReport;
      break;
    case "debate_complete": {
      const both = payload as { bullCase: DebateCase; bearCase: DebateCase };
      ctx.bullCase = both?.bullCase;
      ctx.bearCase = both?.bearCase;
      break;
    }
    case "decision_complete":
      ctx.decision = payload as InvestmentDecision;
      break;
  }
}

/** ctx 是否已具备组装成完整 WorkflowResult 的全部字段。 */
export function isCompleteResult(ctx: WorkflowContext): ctx is Required<WorkflowContext> & WorkflowResult {
  return Boolean(
    ctx.analysis && ctx.sentiment && ctx.report && ctx.bullCase && ctx.bearCase && ctx.decision,
  );
}
