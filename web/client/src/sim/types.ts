export interface SimAccount {
  id: number;
  name: string;
  initialBalance: number;
  cashBalance: number;
  totalAssets: number;
  marketValue: number;
  todayPnl: number | null;
  todayPnlPct: number | null;
  totalPnl: number;
  totalPnlPct: number;
  positionCount: number;
  orderCount: number;
  createdAt: string;
}

export interface SimPosition {
  id: number;
  stockId: number;
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  prevClose: number;
  marketValue: number;
  costValue: number;
  pnl: number;
  pnlPct: number;
  todayPnl: number;
  todayPnlPct: number;
  weight: number;
  buyDate: string | null;
}

export interface SimOrder {
  id: number;
  decisionId: number | null;
  ticker: string;
  name: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  amount: number;
  commission: number;
  stampDuty: number;
  fee: number;
  status: "filled" | "rejected";
  rejectReason: string | null;
  agentId: string | null;
  createdAt: string;
}

export interface SimDecision {
  id: number;
  cycleId: string;
  stockId: number | null;
  ticker: string | null;
  name: string | null;
  action: "buy" | "sell" | "hold";
  quantity: number;
  price: number | null;
  confidence: number;
  reasoning: string | null;
  status: "executed" | "rejected" | "evaluated";
  riskScore: "low" | "medium" | "high";
  triggers: string[];
  reportId: number | null;
  linkedReport: LinkedReport | null;
  portfolioSnapshot: unknown;
  riskChecks: RiskCheckItem[];
  riskAction: string | null;
  orderId: number | null;
  marketOutlook: string | null;
  createdAt: string;
}

export interface LinkedReport {
  id: number;
  stockName: string;
  createdAt: string;
  report: {
    ticker: string;
    investmentSummary: string;
    coreThesis: string[];
    financialAnalysis: string;
    valuationRange: { low: number; base: number; high: number; currency: string; method: string };
    catalysts: string[];
    risks: string[];
    bearCase: string;
    dataSources: string[];
  } | null;
  decision: {
    ticker: string;
    action: string;
    confidence: number;
    targetPrice: number;
    timeHorizon: string;
    rationale: string[];
    riskWarnings: string[];
    assumptions: string[];
  } | null;
  bullCase: { conviction: number; summary: string; coreArguments: string[] } | null;
  bearCase: { conviction: number; summary: string; coreArguments: string[] } | null;
}

export interface RiskCheckItem {
  name: string;
  pass: boolean;
  value: string;
}

export interface SimPerformance {
  totalReturn: number;
  totalReturnPct: number;
  todayPnl: number;
  todayPnlPct: number;
  maxDrawdown: number;
  sharpe: number;
  winRate: number;
  tradeCount: number;
  runDays: number;
  startDate: string;
}

export interface SchedulerStatus {
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface SimConfig {
  [key: string]: unknown;
}

export type MarketState = "open" | "lunch" | "closed";

export interface IndexQuote {
  code: string;
  name: string;
  value: number;
  chg: number;
  chgPct: number;
}

export interface DashReportSummary {
  id: number;
  stock_id: number;
  stock_ticker?: string;
  stock_name?: string;
  action: string;
  confidence: number;
  target_price: number;
  created_at: string;
}

export interface KbReportRef {
  reportId: number;
  stockName: string;
  createdAt: string;
}

export interface KbFile {
  id: number;
  filename: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  pageCount: number | null;
  source: string;
  status: "queued" | "processing" | "ready" | "failed";
  progress: number;
  progressStep: string;
  errorMessage: string | null;
  summary: string | null;
  keyPoints: string[];
  tags: string[];
  uploadedAt: string;
  expiresAt: string;
  daysLeft: number;
  refs: number;
  refList: KbReportRef[];
}

export interface KbFileDetail extends KbFile {
  insight: {
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
  } | null;
}

export interface KbStats {
  total: number;
  processing: number;
  expiringSoon: number;
  referenced: number;
}
