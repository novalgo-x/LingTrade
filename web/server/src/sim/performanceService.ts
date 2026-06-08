import { getDb } from "../db/connection.js";
import { getOrCreateAccount, getPortfolioSnapshot } from "./accountService.js";

export interface PerformanceMetrics {
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

export function utc8Today(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function getPrevDayNav(accountId: number): number | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT nav FROM sim_daily_nav WHERE account_id = ? AND trade_date < ? ORDER BY trade_date DESC LIMIT 1"
  ).get(accountId, utc8Today()) as { nav: number } | undefined;
  return row?.nav;
}

export async function getPerformance(): Promise<PerformanceMetrics> {
  const db = getDb();
  const account = getOrCreateAccount();
  const snapshot = await getPortfolioSnapshot(account.id);

  const totalReturn = snapshot.totalAssets - account.initial_balance;
  const totalReturnPct = account.initial_balance > 0 ? totalReturn / account.initial_balance : 0;

  const baseAssets = getPrevDayNav(account.id) ?? account.initial_balance;
  const todayPnl = snapshot.totalAssets - baseAssets;
  const todayPnlPct = baseAssets > 0 ? todayPnl / baseAssets : 0;

  // Win rate from closed sell orders
  const sells = db.prepare(
    "SELECT o.price, o.quantity, p.avg_cost FROM sim_orders o LEFT JOIN sim_positions p ON o.stock_id = p.stock_id AND o.account_id = p.account_id WHERE o.account_id = ? AND o.side = 'sell' AND o.status = 'filled'"
  ).all(account.id) as Array<{ price: number; quantity: number; avg_cost: number | null }>;

  const totalSells = sells.length;
  const wins = sells.filter(s => s.avg_cost != null && s.price > s.avg_cost).length;
  const winRate = totalSells > 0 ? wins / totalSells : 0;

  const tradeCount = (db.prepare("SELECT COUNT(*) as cnt FROM sim_orders WHERE account_id = ? AND status = 'filled'").get(account.id) as { cnt: number }).cnt;

  // Max drawdown from daily NAV
  const navRows = db.prepare("SELECT nav FROM sim_daily_nav WHERE account_id = ? ORDER BY trade_date ASC").all(account.id) as Array<{ nav: number }>;
  let maxDrawdown = 0;
  let peak = account.initial_balance;
  for (const row of navRows) {
    if (row.nav > peak) peak = row.nav;
    const dd = (peak - row.nav) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (annualized, assuming 2% risk-free rate)
  const returns: number[] = [];
  let prev = account.initial_balance;
  for (const row of navRows) {
    returns.push((row.nav - prev) / prev);
    prev = row.nav;
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const riskFreeDaily = 0.02 / 252;
  const sharpe = stdReturn > 0 ? ((avgReturn - riskFreeDaily) / stdReturn) * Math.sqrt(252) : 0;

  // Run days
  const firstOrder = db.prepare("SELECT MIN(created_at) as first FROM sim_orders WHERE account_id = ?").get(account.id) as { first: string | null };
  const startDate = firstOrder.first?.split("T")[0] ?? new Date().toISOString().split("T")[0] ?? "";
  const runDays = firstOrder.first
    ? Math.max(1, Math.ceil((Date.now() - new Date(firstOrder.first).getTime()) / 86400000))
    : 0;

  return {
    totalReturn,
    totalReturnPct,
    todayPnl,
    todayPnlPct,
    maxDrawdown,
    sharpe,
    winRate,
    tradeCount,
    runDays,
    startDate,
  };
}

export async function recordDailyNav(accountId: number): Promise<void> {
  const db = getDb();
  const snapshot = await getPortfolioSnapshot(accountId);
  const today = utc8Today();
  const positionValue = snapshot.positions.reduce((s, p) => s + p.marketValue, 0);
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO sim_daily_nav (account_id, trade_date, nav, cash, position_value, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id, trade_date) DO UPDATE SET nav = excluded.nav, cash = excluded.cash, position_value = excluded.position_value"
  ).run(accountId, today, snapshot.totalAssets, snapshot.cashBalance, positionValue, now);
}
