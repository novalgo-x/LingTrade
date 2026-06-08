export type RecommendationAction = "buy" | "hold" | "sell";

export type EventType =
  | "earnings"
  | "announcement"
  | "policy"
  | "analyst_report"
  | "social_discussion"
  | "price_volume"
  | "unknown";

export interface SourceReference {
  name: string;
  type: "official" | "market_data" | "financials" | "news" | "social" | "llm" | "mock";
  url?: string;
  credibility: "high" | "medium" | "low";
  commercialUse: "allowed" | "restricted" | "requires_license" | "unknown";
  retrievedAt: string;
  note?: string;
}

export interface QuoteData {
  ticker: string;
  name: string;
  exchange: "SH" | "SZ" | "BJ" | "UNKNOWN";
  industry: string;
  lastPrice: number;
  marketCapCny: number;
  changePct1d: number;
  changePct20d: number;
  volumeRatio: number;
  dataAsOf: string;
  sources: SourceReference[];
}

export interface FinancialSnapshot {
  revenueGrowthYoY: number;
  netProfitGrowthYoY: number;
  grossMargin: number;
  netMargin: number;
  roe: number;
  operatingCashFlowToNetIncome: number;
  debtToAsset: number;
  peTtm: number;
  pb: number;
  dividendYield: number;
  reportingPeriod: string;
  sources: SourceReference[];
}

export interface TechnicalSnapshot {
  trend: "uptrend" | "sideways" | "downtrend";
  aboveMa20: boolean;
  aboveMa60: boolean;
  rsi14: number;
  volatility20d: number;
  support: number;
  resistance: number;
  sources: SourceReference[];
}

export interface PeerComparison {
  peerTicker: string;
  peerName: string;
  peTtm: number;
  pb: number;
  roe: number;
  revenueGrowthYoY: number;
}

export interface SentimentInputItem {
  sourceType: "news" | "announcement" | "social" | "research_title" | "earnings_call";
  title: string;
  summary: string;
  publishedAt: string;
  engagement: number;
  source: SourceReference;
}

export interface DailyPrice {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  pctChange: number;
}

export interface MoneyFlowDay {
  tradeDate: string;
  buySmAmount: number;
  sellSmAmount: number;
  buyLgAmount: number;
  sellLgAmount: number;
  buyElgAmount: number;
  sellElgAmount: number;
  netMfAmount: number;
}

export interface EarningsForecast {
  annDate: string;
  endDate: string;
  type: string;
  pChangeMin: number;
  pChangeMax: number;
  netProfitMin: number;
  netProfitMax: number;
  summary: string;
  changeReason: string;
}

export interface HolderTrade {
  annDate: string;
  holderName: string;
  holderType: string;
  inDe: string;
  changeVol: number;
  changeRatio: number;
  afterRatio: number;
  avgPrice: number;
}

export interface TopListEntry {
  tradeDate: string;
  name: string;
  pctChange: number;
  amount: number;
  buyAmount: number;
  sellAmount: number;
  netAmount: number;
  reason: string;
}

export interface TopInstEntry {
  tradeDate: string;
  exalter: string;
  buy: number;
  sell: number;
  netBuy: number;
  side: string;
  reason: string;
}

export interface MarginDay {
  tradeDate: string;
  rzye: number;
  rzmre: number;
  rqye: number;
  rzrqye: number;
}

export interface InstitutionSurvey {
  survDate: string;
  orgName: string;
  orgType: string;
  receOrg: string;
  content: string;
}

export interface ConceptTag {
  conceptName: string;
}

export interface RawStockDataset {
  quote: QuoteData;
  financials: FinancialSnapshot;
  technicals: TechnicalSnapshot;
  peers: PeerComparison[];
  sentimentItems: SentimentInputItem[];
  dailyPrices: DailyPrice[];
  moneyFlow: MoneyFlowDay[];
  earningsForecasts: EarningsForecast[];
  holderTrades: HolderTrade[];
  topList: TopListEntry[];
  topInst: TopInstEntry[];
  margin: MarginDay[];
  institutionSurveys: InstitutionSurvey[];
  concepts: ConceptTag[];
  /** 因数据源权限不足等原因未能获取的数据项说明，供分析时识别数据盲区 */
  dataGaps?: string[];
}

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
  sources: SourceReference[];
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
  sources: SourceReference[];
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
  dataSources: SourceReference[];
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
  sources: SourceReference[];
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
  sources: SourceReference[];
}

export interface KnowledgeDocument {
  filePath: string;
  author: string;
  title: string;
  publishDate: string;
  content: string;
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
  knowledgeInsights: KnowledgeInsight[];
  analysis: StockAnalysis;
  sentiment: SentimentReport;
  report: InvestmentReport;
  bullCase: DebateCase;
  bearCase: DebateCase;
  decision: InvestmentDecision;
}
