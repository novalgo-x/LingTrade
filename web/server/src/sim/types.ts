// --- Config ---
export interface TradingConfig {
  commissionRate: number;
  commissionMin: number;
  stampDutyRate: number;
  lotSize: number;
  t1Settlement: boolean;
}

export interface RiskConfig {
  maxPositionPct: number;
  maxHoldings: number;
  maxSingleBuyPct: number;
  stopLossPct: number;
  minCashPct: number;
}

export interface SchedulerConfig {
  intervalMinutes: number;
  reportRefreshHours: number;
  enabled: boolean;
}

// --- DB Rows ---
export interface SimAccountRow {
  id: number;
  name: string;
  initial_balance: number;
  cash_balance: number;
  created_at: string;
  updated_at: string;
}

export interface SimPositionRow {
  id: number;
  account_id: number;
  stock_id: number;
  ticker: string;
  quantity: number;
  avg_cost: number;
  buy_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimOrderRow {
  id: number;
  account_id: number;
  stock_id: number;
  decision_id: number | null;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  amount: number;
  commission: number;
  stamp_duty: number;
  status: "filled" | "rejected";
  reject_reason: string | null;
  created_at: string;
}

export interface SimDecisionRow {
  id: number;
  account_id: number;
  cycle_id: string;
  stock_id: number | null;
  ticker: string | null;
  action: "buy" | "sell" | "hold";
  quantity: number;
  price_at_decision: number | null;
  reasoning: string | null;
  report_id: number | null;
  portfolio_snapshot: string | null;
  risk_check_result: string | null;
  risk_action: string | null;
  final_action: string | null;
  order_id: number | null;
  confidence: number;
  triggers: string | null;
  market_outlook: string | null;
  trading_style: string | null;
  created_at: string;
}

export interface SimDailyNavRow {
  id: number;
  account_id: number;
  trade_date: string;
  nav: number;
  cash: number;
  position_value: number;
  created_at: string;
}

// --- Business Logic ---
export interface PortfolioSnapshot {
  cashBalance: number;
  totalAssets: number;
  positions: PositionDetail[];
}

export interface PositionDetail {
  ticker: string;
  name: string;
  stockId: number;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  todayPnl: number;
  todayPnlPct: number;
  weight: number;
  buyDate: string | null;
}

export interface RiskCheckResult {
  approved: boolean;
  adjustedQuantity?: number;
  warnings: string[];
  violations: string[];
  checks: RiskCheckItem[];
}

export interface RiskCheckItem {
  name: string;
  pass: boolean;
  value: string;
}

export interface FeeResult {
  commission: number;
  stampDuty: number;
  total: number;
}

export interface AgentDecisionInput {
  ticker: string;
  action: "buy" | "sell" | "hold";
  quantity: number;
  confidence: number;
  reasoning: string;
}

export interface AgentDecisionOutput {
  decisions: AgentDecisionInput[];
  marketOutlook: string;
  portfolioStrategy: string;
  // LLM 调用/解析失败的简短原因，供调度器透出到 UI；成功时不设置
  error?: string;
}

export interface SchedulerStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunDecisions: number | null;
  lastRunError: string | null;
  nextRunAt: string | null;
  currentCycleId: string | null;
}
