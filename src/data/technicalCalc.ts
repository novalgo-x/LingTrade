import type { DailyPrice } from "../domain/types.js";

export function calculateMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i]!;
  return Number((sum / period).toFixed(2));
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = closes[i]! - closes[i + 1]!;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

export function calculateVolatility(closes: number[], period = 20): number {
  if (closes.length <= period) return 0;
  const returns: number[] = [];
  for (let i = 0; i < period; i++) {
    const prev = closes[i + 1]!;
    if (prev > 0) returns.push(Math.log(closes[i]! / prev));
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Number((Math.sqrt(variance * 252) * 100).toFixed(1));
}

export function calculateChangePct(closes: number[], period: number): number {
  if (closes.length <= period) return 0;
  const current = closes[0]!;
  const past = closes[period]!;
  if (past === 0) return 0;
  return Number((((current - past) / past) * 100).toFixed(2));
}

export function findSupport(prices: DailyPrice[], period = 20): number {
  if (prices.length === 0) return 0;
  let min = prices[0]!.low;
  const n = Math.min(period, prices.length);
  for (let i = 1; i < n; i++) {
    if (prices[i]!.low < min) min = prices[i]!.low;
  }
  return min;
}

export function findResistance(prices: DailyPrice[], period = 20): number {
  if (prices.length === 0) return 0;
  let max = prices[0]!.high;
  const n = Math.min(period, prices.length);
  for (let i = 1; i < n; i++) {
    if (prices[i]!.high > max) max = prices[i]!.high;
  }
  return max;
}

export function determineTrend(closes: number[]): "uptrend" | "sideways" | "downtrend" {
  const ma5 = calculateMA(closes, 5);
  const ma20 = calculateMA(closes, 20);
  if (!ma5 || !ma20) return "sideways";
  const diff = ((ma5 - ma20) / ma20) * 100;
  if (diff > 2) return "uptrend";
  if (diff < -2) return "downtrend";
  return "sideways";
}
