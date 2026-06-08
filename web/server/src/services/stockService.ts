import { getDb } from "../db/connection.js";
import { lookupStockBasic } from "./tushareService.js";

export interface StockRow {
  id: number;
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function inferExchange(ticker: string): string {
  if (ticker.startsWith("6")) return "SH";
  if (ticker.startsWith("0") || ticker.startsWith("3")) return "SZ";
  if (ticker.startsWith("8") || ticker.startsWith("4")) return "BJ";
  return "";
}

export function listStocks(search?: string): StockRow[] {
  const db = getDb();
  if (search) {
    return db
      .prepare("SELECT * FROM stocks WHERE ticker LIKE ? OR name LIKE ? ORDER BY created_at DESC")
      .all(`%${search}%`, `%${search}%`) as StockRow[];
  }
  return db.prepare("SELECT * FROM stocks ORDER BY created_at DESC").all() as StockRow[];
}

export function getStock(id: number): StockRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM stocks WHERE id = ?").get(id) as StockRow | undefined;
}

export async function createStock(ticker: string, name?: string, notes?: string): Promise<StockRow> {
  const db = getDb();
  const now = new Date().toISOString();
  const exchange = inferExchange(ticker);

  let resolvedName = name ?? "";
  let sector = "";

  const info = await lookupStockBasic(ticker);
  if (info) {
    if (!resolvedName) resolvedName = info.name;
    sector = info.sector;
  }

  const result = db
    .prepare("INSERT INTO stocks (ticker, name, exchange, sector, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(ticker, resolvedName, exchange, sector, notes ?? "", now, now);
  return getStock(Number(result.lastInsertRowid))!;
}

export function updateStock(id: number, fields: { name?: string; notes?: string }): StockRow | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  const stock = getStock(id);
  if (!stock) return undefined;
  db.prepare("UPDATE stocks SET name = ?, notes = ?, updated_at = ? WHERE id = ?").run(
    fields.name ?? stock.name,
    fields.notes ?? stock.notes,
    now,
    id
  );
  return getStock(id);
}

export async function backfillStockInfo(): Promise<{ updated: number; total: number }> {
  const db = getDb();
  const stocks = db.prepare("SELECT * FROM stocks WHERE sector = '' OR name = ''").all() as StockRow[];
  let updated = 0;
  for (const s of stocks) {
    const info = await lookupStockBasic(s.ticker);
    if (!info) continue;
    const newName = s.name || info.name;
    const newSector = s.sector || info.sector;
    if (newName !== s.name || newSector !== s.sector) {
      db.prepare("UPDATE stocks SET name = ?, sector = ?, updated_at = ? WHERE id = ?")
        .run(newName, newSector, new Date().toISOString(), s.id);
      updated++;
    }
  }
  return { updated, total: stocks.length };
}

export function deleteStock(id: number): boolean {
  const db = getDb();
  const stock = getStock(id);
  if (!stock) return false;
  const del = db.transaction(() => {
    db.prepare("DELETE FROM reports WHERE stock_id = ?").run(id);
    db.prepare("DELETE FROM analysis_tasks WHERE stock_id = ?").run(id);
    db.prepare("DELETE FROM stocks WHERE id = ?").run(id);
  });
  del();
  return true;
}
