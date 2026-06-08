import { getDb } from "../db/connection.js";
import type { TradingConfig, RiskConfig, SchedulerConfig } from "./types.js";

const DEFAULTS: Record<string, unknown> = {
  "trading.commissionRate": 0.00025,
  "trading.commissionMin": 5,
  "trading.stampDutyRate": 0.0005,
  "trading.lotSize": 100,
  "trading.t1Settlement": true,
  "risk.maxPositionPct": 0.30,
  "risk.maxHoldings": 10,
  "risk.maxSingleBuyPct": 0.15,
  "risk.stopLossPct": -0.20,
  "risk.minCashPct": 0.10,
  "scheduler.intervalMinutes": 30,
  "scheduler.reportRefreshHours": 24,
  "scheduler.enabled": false,
  "scheduler.reportFrequency": "manual",
  "scheduler.reportScope": "positions",
  "scheduler.reportTime": "08:30",
  "scheduler.decisionEnabled": true,
  "scheduler.decisionInterval": 30,
  "scheduler.decisionTradingOnly": true,
};

export function getConfig<T>(key: string): T {
  const db = getDb();
  const row = db.prepare("SELECT value FROM sim_config WHERE key = ?").get(key) as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as T;
  return DEFAULTS[key] as T;
}

export function setConfig(key: string, value: unknown): void {
  const db = getDb();
  const now = new Date().toISOString();
  const json = JSON.stringify(value);
  db.prepare(
    "INSERT INTO sim_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, json, now);
}

export function getAllConfig(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM sim_config").all() as Array<{ key: string; value: string }>;
  const result: Record<string, unknown> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }
  return result;
}

export function setMultipleConfig(entries: Record<string, unknown>): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO sim_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      stmt.run(key, JSON.stringify(value), now);
    }
  });
  tx();
}

export function getTradingConfig(): TradingConfig {
  return {
    commissionRate: getConfig<number>("trading.commissionRate"),
    commissionMin: getConfig<number>("trading.commissionMin"),
    stampDutyRate: getConfig<number>("trading.stampDutyRate"),
    lotSize: getConfig<number>("trading.lotSize"),
    t1Settlement: getConfig<boolean>("trading.t1Settlement"),
  };
}

export function getRiskConfig(): RiskConfig {
  return {
    maxPositionPct: getConfig<number>("risk.maxPositionPct"),
    maxHoldings: getConfig<number>("risk.maxHoldings"),
    maxSingleBuyPct: getConfig<number>("risk.maxSingleBuyPct"),
    stopLossPct: getConfig<number>("risk.stopLossPct"),
    minCashPct: getConfig<number>("risk.minCashPct"),
  };
}

export function getSchedulerConfig(): SchedulerConfig {
  return {
    intervalMinutes: getConfig<number>("scheduler.intervalMinutes"),
    reportRefreshHours: getConfig<number>("scheduler.reportRefreshHours"),
    enabled: getConfig<boolean>("scheduler.enabled"),
  };
}
