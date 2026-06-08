import { getDb } from "../db/connection.js";
import { calculateFees } from "./virtualMarket.js";
import type { SimAccountRow, SimPositionRow, SimOrderRow, PortfolioSnapshot, PositionDetail } from "./types.js";

// --- Account ---

export function getOrCreateAccount(name = "default"): SimAccountRow {
  const db = getDb();
  let row = db.prepare("SELECT * FROM sim_accounts WHERE name = ?").get(name) as SimAccountRow | undefined;
  if (row) return row;
  const now = new Date().toISOString();
  const info = db.prepare(
    "INSERT INTO sim_accounts (name, initial_balance, cash_balance, created_at, updated_at) VALUES (?, 1000000, 1000000, ?, ?)"
  ).run(name, now, now);
  return db.prepare("SELECT * FROM sim_accounts WHERE id = ?").get(info.lastInsertRowid) as SimAccountRow;
}

export function resetAccount(accountId: number, initialBalance?: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const account = db.prepare("SELECT initial_balance FROM sim_accounts WHERE id = ?").get(accountId) as { initial_balance: number } | undefined;
    if (!account) throw new Error(`Account ${accountId} not found`);
    const now = new Date().toISOString();
    const bal = initialBalance ?? account.initial_balance;
    db.prepare("UPDATE sim_accounts SET initial_balance = ?, cash_balance = ?, created_at = ?, updated_at = ? WHERE id = ?").run(bal, bal, now, now, accountId);
    db.prepare("DELETE FROM sim_positions WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM sim_orders WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM sim_decisions WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM sim_daily_nav WHERE account_id = ?").run(accountId);
  });
  tx();
  snapshotCache = null;
}

export function clearDecisions(accountId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM sim_decisions WHERE account_id = ?").run(accountId);
}

// --- Positions ---

export function getPositions(accountId: number): SimPositionRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM sim_positions WHERE account_id = ? AND quantity > 0").all(accountId) as SimPositionRow[];
}

export function getPositionByStock(accountId: number, stockId: number): SimPositionRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM sim_positions WHERE account_id = ? AND stock_id = ?").get(accountId, stockId) as SimPositionRow | undefined;
}

// --- Orders ---

export function getOrders(accountId: number, limit = 50, offset = 0, side?: string, status?: string): SimOrderRow[] {
  const db = getDb();
  let sql = "SELECT * FROM sim_orders WHERE account_id = ?";
  const params: unknown[] = [accountId];
  if (side) { sql += " AND side = ?"; params.push(side); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return db.prepare(sql).all(...params) as SimOrderRow[];
}

export function getOrderCount(accountId: number): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as cnt FROM sim_orders WHERE account_id = ?").get(accountId) as { cnt: number }).cnt;
}

// --- Trade Execution ---

export interface TradeResult {
  success: boolean;
  orderId?: number;
  rejectReason?: string;
}

export function executeBuy(
  accountId: number, stockId: number, ticker: string, quantity: number, price: number, decisionId?: number
): TradeResult {
  const db = getDb();
  const amount = quantity * price;
  const fees = calculateFees("buy", amount);
  const totalCost = amount + fees.total;

  const account = db.prepare("SELECT * FROM sim_accounts WHERE id = ?").get(accountId) as SimAccountRow | undefined;
  if (!account) return { success: false, rejectReason: "Account not found" };
  if (account.cash_balance < totalCost) {
    // Record rejected order
    const now = new Date().toISOString();
    const info = db.prepare(
      "INSERT INTO sim_orders (account_id, stock_id, decision_id, ticker, side, quantity, price, amount, commission, stamp_duty, status, reject_reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(accountId, stockId, decisionId ?? null, ticker, "buy", quantity, price, amount, fees.commission, fees.stampDuty, "rejected", "Insufficient cash", now);
    return { success: false, orderId: Number(info.lastInsertRowid), rejectReason: "Insufficient cash" };
  }

  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    // Deduct cash
    db.prepare("UPDATE sim_accounts SET cash_balance = cash_balance - ?, updated_at = ? WHERE id = ?")
      .run(totalCost, now, accountId);

    // Upsert position (weighted average cost)
    const existing = db.prepare("SELECT * FROM sim_positions WHERE account_id = ? AND stock_id = ?").get(accountId, stockId) as SimPositionRow | undefined;
    if (existing) {
      const newQty = existing.quantity + quantity;
      const newAvgCost = (existing.avg_cost * existing.quantity + amount) / newQty;
      db.prepare("UPDATE sim_positions SET quantity = ?, avg_cost = ?, updated_at = ? WHERE id = ?")
        .run(newQty, newAvgCost, now, existing.id);
    } else {
      db.prepare(
        "INSERT INTO sim_positions (account_id, stock_id, ticker, quantity, avg_cost, buy_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
      ).run(accountId, stockId, ticker, quantity, price, now, now, now);
    }

    // Insert order
    const info = db.prepare(
      "INSERT INTO sim_orders (account_id, stock_id, decision_id, ticker, side, quantity, price, amount, commission, stamp_duty, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(accountId, stockId, decisionId ?? null, ticker, "buy", quantity, price, amount, fees.commission, fees.stampDuty, "filled", now);

    return Number(info.lastInsertRowid);
  });

  const orderId = tx();
  snapshotCache = null;
  return { success: true, orderId };
}

export function executeSell(
  accountId: number, stockId: number, ticker: string, quantity: number, price: number, decisionId?: number
): TradeResult {
  const db = getDb();
  const amount = quantity * price;
  const fees = calculateFees("sell", amount);

  const position = db.prepare("SELECT * FROM sim_positions WHERE account_id = ? AND stock_id = ?").get(accountId, stockId) as SimPositionRow | undefined;
  if (!position || position.quantity < quantity) {
    const now = new Date().toISOString();
    const info = db.prepare(
      "INSERT INTO sim_orders (account_id, stock_id, decision_id, ticker, side, quantity, price, amount, commission, stamp_duty, status, reject_reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(accountId, stockId, decisionId ?? null, ticker, "sell", quantity, price, amount, fees.commission, fees.stampDuty, "rejected", "Insufficient position", now);
    return { success: false, orderId: Number(info.lastInsertRowid), rejectReason: "Insufficient position" };
  }

  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    const netProceeds = amount - fees.total;

    // Add cash
    db.prepare("UPDATE sim_accounts SET cash_balance = cash_balance + ?, updated_at = ? WHERE id = ?")
      .run(netProceeds, now, accountId);

    // Reduce position
    const newQty = position.quantity - quantity;
    if (newQty === 0) {
      db.prepare("DELETE FROM sim_positions WHERE id = ?").run(position.id);
    } else {
      db.prepare("UPDATE sim_positions SET quantity = ?, updated_at = ? WHERE id = ?")
        .run(newQty, now, position.id);
    }

    // Insert order
    const info = db.prepare(
      "INSERT INTO sim_orders (account_id, stock_id, decision_id, ticker, side, quantity, price, amount, commission, stamp_duty, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(accountId, stockId, decisionId ?? null, ticker, "sell", quantity, price, amount, fees.commission, fees.stampDuty, "filled", now);

    return Number(info.lastInsertRowid);
  });

  const orderId = tx();
  snapshotCache = null;
  return { success: true, orderId };
}

// --- Portfolio Snapshot ---

let snapshotCache: { accountId: number; ts: number; data: PortfolioSnapshot } | null = null;
let inflightSnapshot: Promise<PortfolioSnapshot> | null = null;

export async function getPortfolioSnapshot(accountId: number): Promise<PortfolioSnapshot> {
  const now = Date.now();
  if (snapshotCache && snapshotCache.accountId === accountId && now - snapshotCache.ts < 3000) {
    return snapshotCache.data;
  }
  if (inflightSnapshot) return inflightSnapshot;
  inflightSnapshot = computeSnapshot(accountId).finally(() => { inflightSnapshot = null; });
  return inflightSnapshot;
}

async function computeSnapshot(accountId: number): Promise<PortfolioSnapshot> {

  const { getBatchQuotes } = await import("./virtualMarket.js");
  const db = getDb();
  const account = db.prepare("SELECT * FROM sim_accounts WHERE id = ?").get(accountId) as SimAccountRow;
  const positions = getPositions(accountId);

  const stocks = new Map<number, { name: string }>();
  for (const pos of positions) {
    const stock = db.prepare("SELECT name FROM stocks WHERE id = ?").get(pos.stock_id) as { name: string } | undefined;
    if (stock) stocks.set(pos.stock_id, stock);
  }

  const quoteMap = await getBatchQuotes(positions.map(pos => pos.ticker));

  const details: PositionDetail[] = positions.map((pos) => {
    const quote = quoteMap.get(pos.ticker) ?? null;
    const stock = stocks.get(pos.stock_id);
    const currentPrice = quote?.price ?? pos.avg_cost;
    const prevClose = quote?.prevClose ?? pos.avg_cost;
    const marketValue = pos.quantity * currentPrice;
    const costValue = pos.quantity * pos.avg_cost;
    const quoteTradingDay = new Date((quote?.quoteTime ?? Date.now()) + 8 * 3600000).toISOString().slice(0, 10);
    const boughtInWindow = pos.buy_date?.slice(0, 10) === quoteTradingDay;
    const todayRef = boughtInWindow ? pos.avg_cost : prevClose;

    return {
      ticker: pos.ticker,
      name: stock?.name ?? pos.ticker,
      stockId: pos.stock_id,
      quantity: pos.quantity,
      avgCost: pos.avg_cost,
      currentPrice,
      marketValue,
      unrealizedPnl: marketValue - costValue,
      unrealizedPnlPct: costValue > 0 ? (marketValue - costValue) / costValue : 0,
      todayPnl: pos.quantity * (currentPrice - todayRef),
      todayPnlPct: todayRef > 0 ? (currentPrice - todayRef) / todayRef : 0,
      weight: 0,
      buyDate: pos.buy_date,
    };
  });

  const positionValue = details.reduce((s, d) => s + d.marketValue, 0);
  const totalAssets = account.cash_balance + positionValue;

  for (const d of details) {
    d.weight = totalAssets > 0 ? d.marketValue / totalAssets : 0;
  }

  const result = { cashBalance: account.cash_balance, totalAssets, positions: details };
  snapshotCache = { accountId, ts: Date.now(), data: result };
  return result;
}

export function invalidateSnapshotCache(): void {
  snapshotCache = null;
  inflightSnapshot = null;
}
