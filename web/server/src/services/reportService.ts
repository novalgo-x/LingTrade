import { getDb } from "../db/connection.js";

export interface ReportRow {
  id: number;
  task_id: number;
  stock_id: number;
  result_json: string;
  created_at: string;
}

export interface ReportSummary {
  id: number;
  task_id: number;
  stock_id: number;
  stock_ticker?: string;
  stock_name?: string;
  action: string;
  confidence: number;
  target_price: number;
  report_count: number;
  created_at: string;
}

export function createReport(taskId: number, stockId: number, resultJson: string): ReportRow {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO reports (task_id, stock_id, result_json, created_at) VALUES (?, ?, ?, ?)")
    .run(taskId, stockId, resultJson, now);
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(Number(result.lastInsertRowid)) as ReportRow;
}

export function getReport(id: number): ReportRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
}

export function listReportsByStock(stockId: number): ReportSummary[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, task_id, stock_id, result_json, created_at FROM reports WHERE stock_id = ? ORDER BY created_at DESC")
    .all(stockId) as ReportRow[];
  const count = rows.length;

  return rows.map((row) => {
    let action = "unknown";
    let confidence = 0;
    let targetPrice = 0;
    try {
      const parsed = JSON.parse(row.result_json);
      action = parsed.decision?.action ?? "unknown";
      confidence = parsed.decision?.confidence ?? 0;
      targetPrice = parsed.decision?.targetPrice ?? 0;
    } catch {
      // keep defaults
    }
    return {
      id: row.id,
      task_id: row.task_id,
      stock_id: row.stock_id,
      action,
      confidence,
      target_price: targetPrice,
      report_count: count,
      created_at: row.created_at,
    };
  });
}

export function getLatestReportsForAllStocks(): ReportSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.id, r.task_id, r.stock_id, r.result_json, r.created_at,
           s.ticker as stock_ticker, s.name as stock_name,
           latest.cnt as report_count
    FROM reports r
    INNER JOIN (
      SELECT stock_id, MAX(created_at) as max_created, COUNT(*) as cnt FROM reports GROUP BY stock_id
    ) latest ON r.stock_id = latest.stock_id AND r.created_at = latest.max_created
    LEFT JOIN stocks s ON r.stock_id = s.id
    ORDER BY r.created_at DESC
  `).all() as (ReportRow & { report_count: number; stock_ticker?: string; stock_name?: string })[];

  return rows.map((row) => {
    let action = "unknown";
    let confidence = 0;
    let targetPrice = 0;
    try {
      const parsed = JSON.parse(row.result_json);
      action = parsed.decision?.action ?? "unknown";
      confidence = parsed.decision?.confidence ?? 0;
      targetPrice = parsed.decision?.targetPrice ?? 0;
    } catch {}
    return {
      id: row.id,
      task_id: row.task_id,
      stock_id: row.stock_id,
      stock_ticker: row.stock_ticker,
      stock_name: row.stock_name,
      action,
      confidence,
      target_price: targetPrice,
      report_count: row.report_count,
      created_at: row.created_at,
    };
  });
}

export function deleteReport(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  return result.changes > 0;
}
