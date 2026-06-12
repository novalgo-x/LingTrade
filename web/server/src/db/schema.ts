import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      exchange TEXT NOT NULL DEFAULT '',
      sector TEXT NOT NULL DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id),
      status TEXT NOT NULL DEFAULT 'pending',
      cli_args TEXT NOT NULL,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES analysis_tasks(id),
      stock_id INTEGER NOT NULL REFERENCES stocks(id),
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'default',
      initial_balance REAL NOT NULL DEFAULT 1000000,
      cash_balance REAL NOT NULL DEFAULT 1000000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES sim_accounts(id),
      stock_id INTEGER NOT NULL REFERENCES stocks(id),
      ticker TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      buy_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, stock_id)
    );

    CREATE TABLE IF NOT EXISTS sim_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES sim_accounts(id),
      stock_id INTEGER NOT NULL REFERENCES stocks(id),
      decision_id INTEGER,
      ticker TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      commission REAL NOT NULL DEFAULT 0,
      stamp_duty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('filled', 'rejected')),
      reject_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES sim_accounts(id),
      cycle_id TEXT NOT NULL,
      stock_id INTEGER REFERENCES stocks(id),
      ticker TEXT,
      action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'hold')),
      quantity INTEGER NOT NULL DEFAULT 0,
      price_at_decision REAL,
      reasoning TEXT,
      report_id INTEGER,
      portfolio_snapshot TEXT,
      risk_check_result TEXT,
      risk_action TEXT,
      final_action TEXT,
      order_id INTEGER,
      confidence REAL DEFAULT 0,
      triggers TEXT,
      market_outlook TEXT,
      trading_style TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_daily_nav (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES sim_accounts(id),
      trade_date TEXT NOT NULL,
      nav REAL NOT NULL,
      cash REAL NOT NULL,
      position_value REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(account_id, trade_date)
    );

    CREATE TABLE IF NOT EXISTS kb_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER,
      source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','processing','ready','failed')),
      progress INTEGER NOT NULL DEFAULT 0,
      progress_step TEXT NOT NULL DEFAULT '',
      error_message TEXT,
      insight_json TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      uploaded_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const cols = db.pragma("table_info(stocks)") as Array<{ name: string }>;
  if (!cols.some(c => c.name === "sector")) {
    db.exec("ALTER TABLE stocks ADD COLUMN sector TEXT NOT NULL DEFAULT ''");
  }

  const decisionCols = db.pragma("table_info(sim_decisions)") as Array<{ name: string }>;
  if (!decisionCols.some(c => c.name === "trading_style")) {
    db.exec("ALTER TABLE sim_decisions ADD COLUMN trading_style TEXT");
  }
}
