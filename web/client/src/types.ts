export type RecommendationAction = "buy" | "hold" | "sell";

export type EventType =
  | "earnings"
  | "announcement"
  | "policy"
  | "analyst_report"
  | "social_discussion"
  | "price_volume"
  | "unknown";

export interface StockAnalysis {
  ticker: string;
  companyOverview: string;
  financialQuality: string;
  growth: string;
  profitability: string;
  cashFlow: string;
  valuation: string;
  technicals: string;
  industryComparison: string;
  risks: string[];
  dataAsOf: string;
}

export interface SentimentReport {
  ticker: string;
  sentimentScore: number;
  heatChange: number;
  disagreement: number;
  eventTypes: EventType[];
  summary: string;
  topSignals: string[];
  dataAsOf: string;
}

export interface InvestmentReport {
  ticker: string;
  investmentSummary: string;
  coreThesis: string[];
  financialAnalysis: string;
  valuationRange: {
    low: number;
    base: number;
    high: number;
    currency: "CNY";
    method: string;
  };
  catalysts: string[];
  risks: string[];
  bearCase: string;
}

export interface DebateCase {
  ticker: string;
  side: "bull" | "bear";
  coreArguments: string[];
  evidencePoints: string[];
  rebuttals: string[];
  concessions: string[];
  conviction: number;
  summary: string;
}

export interface InvestmentDecision {
  ticker: string;
  action: RecommendationAction;
  confidence: number;
  targetPrice: number;
  timeHorizon: string;
  rationale: string[];
  riskWarnings: string[];
  counterArguments: string[];
  assumptions: string[];
  suitability: string;
  generatedAt: string;
}

export interface KnowledgeInsight {
  author: string;
  title: string;
  publishDate: string;
  marketOutlook: string;
  sectorViews: string[];
  stockMentions: string[];
  keyPoints: string[];
  riskFactors: string[];
  investmentThemes: string[];
  summary: string;
}

export interface WorkflowResult {
  knowledgeInsights?: KnowledgeInsight[];
  analysis: StockAnalysis;
  sentiment: SentimentReport;
  report: InvestmentReport;
  bullCase?: DebateCase;
  bearCase?: DebateCase;
  decision: InvestmentDecision;
}

export interface Stock {
  id: number;
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AnalysisTask {
  id: number;
  stock_id: number;
  status: "pending" | "running" | "completed" | "failed";
  cli_args: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ReportSummary {
  id: number;
  task_id: number;
  stock_id: number;
  action: string;
  confidence: number;
  target_price: number;
  report_count: number;
  created_at: string;
}

export interface ReportFull {
  id: number;
  task_id: number;
  stock_id: number;
  result_json: WorkflowResult;
  created_at: string;
}

export type StageId =
  | "data_loaded"
  | "knowledge_loaded"
  | "analysis_complete"
  | "sentiment_complete"
  | "report_complete"
  | "debate_complete"
  | "decision_complete";

export type StageStatus = "running" | "done" | "failed" | "skipped";

export interface StageRow {
  id: number;
  task_id: number;
  stage: StageId;
  stage_index: number;
  status: StageStatus;
  summary: string | null;
  result_json: string | null;
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
}

export type StageEvent =
  | { kind: "stage_start"; stage: StageId; index: number; at: string }
  | { kind: "substep"; stage: StageId; text: string; side?: "bull" | "bear"; at: string }
  | { kind: "stage_done"; stage: StageId; index: number; summary: string; durationMs: number; skipped?: boolean; at: string }
  | { kind: "stage_failed"; stage: StageId; index: number; error: string; durationMs: number; at: string };
