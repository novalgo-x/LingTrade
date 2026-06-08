import { getTradingConfig, getConfig as getDbConfig } from "./configService.js";
import type { FeeResult } from "./types.js";

export interface QuoteResult {
  ticker: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  changePct: number;
  quoteTime: number;
  pe_ttm?: number | null;
  pb?: number | null;
  market_capital?: number | null;
  float_market_capital?: number | null;
  turnover_rate?: number | null;
  dividend_yield?: number | null;
  total_shares?: number | null;
}

export function isTradingTime(now: Date = new Date()): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 60 + m;
  const morningOpen = 9 * 60 + 30;
  const morningClose = 11 * 60 + 30;
  const afternoonOpen = 13 * 60;
  const afternoonClose = 15 * 60;
  return (t >= morningOpen && t <= morningClose) || (t >= afternoonOpen && t < afternoonClose);
}

export function getMarketState(now: Date = new Date()): "open" | "lunch" | "closed" | "auction" | "pre" {
  const day = now.getDay();
  if (day === 0 || day === 6) return "closed";
  const t = now.getHours() * 60 + now.getMinutes();
  if (t >= 9 * 60 + 15 && t < 9 * 60 + 25) return "auction";
  if (t >= 14 * 60 + 57 && t < 15 * 60) return "auction";
  if (t >= 9 * 60 + 25 && t < 9 * 60 + 30) return "pre";
  if ((t >= 9 * 60 + 30 && t <= 11 * 60 + 30) || (t >= 13 * 60 && t < 14 * 60 + 57)) return "open";
  if (t > 11 * 60 + 30 && t < 13 * 60) return "lunch";
  return "closed";
}

export function calculateFees(side: "buy" | "sell", amount: number): FeeResult {
  const config = getTradingConfig();
  const commission = Math.max(amount * config.commissionRate, config.commissionMin);
  const stampDuty = side === "sell" ? amount * config.stampDutyRate : 0;
  return { commission, stampDuty, total: commission + stampDuty };
}

export function roundToLot(quantity: number): number {
  const config = getTradingConfig();
  return Math.floor(quantity / config.lotSize) * config.lotSize;
}

export interface MinutePoint {
  timestamp: number;
  price: number;
  volume: number;
  avgPrice: number;
  percent: number;
}

export interface KlinePoint {
  timestamp: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  percent: number;
  turnoverRate: number;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// ── Cache infrastructure ──

interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return undefined; }
  return entry.data;
}

function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function minuteTtl(): number {
  return isTradingTime() ? 30_000 : 5 * 60_000;
}

function klineTtl(period: string): number {
  if (period === "day" || period === "week" || period === "month") return 5 * 60_000;
  return isTradingTime() ? 60_000 : 5 * 60_000;
}

// ── Xueqiu session cookie ──

let _sessionCookie: string | null = null;
let _sessionExpiry = 0;

function getUserCookie(): string {
  return getDbConfig<string>("xueqiu.cookie") || "";
}

async function getSessionCookie(): Promise<string | null> {
  const manual = getUserCookie();
  if (manual) return manual;

  if (_sessionCookie && Date.now() < _sessionExpiry) return _sessionCookie;
  try {
    const resp = await fetch("https://xueqiu.com/hq", { headers: { "User-Agent": UA } });
    const raw = resp.headers.getSetCookie();
    if (raw.length > 0) {
      _sessionCookie = raw.map(c => c.split(";")[0]).join("; ");
      _sessionExpiry = Date.now() + 25 * 60 * 1000;
      return _sessionCookie;
    }
    return null;
  } catch {
    return null;
  }
}

export { getSessionCookie as _getSessionCookie };

function normalizeTickerToXueqiu(ticker: string): string {
  if (/^(SH|SZ|BJ)\d{6}$/.test(ticker)) return ticker;
  const code = ticker.replace(/\.(SH|SZ|BJ)$/i, "");
  if (code.startsWith("6")) return `SH${code}`;
  if (code.startsWith("0") || code.startsWith("3")) return `SZ${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `BJ${code}`;
  return ticker;
}

export async function getCurrentPrice(ticker: string): Promise<QuoteResult | null> {
  const key = `quote-detail:${ticker}`;
  const cached = cacheGet<QuoteResult>(key);
  if (cached) return cached;

  const cookie = await getSessionCookie();
  if (!cookie) return null;

  const symbol = normalizeTickerToXueqiu(ticker);
  const url = `https://stock.xueqiu.com/v5/stock/quote.json?symbol=${symbol}&extend=detail`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(url, {
      headers: {
        Cookie: cookie,
        "User-Agent": UA,
        Referer: "https://xueqiu.com/",
      },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { data?: { quote?: Record<string, unknown> } };
    const q = data.data?.quote;
    if (!q || typeof q.current !== "number") return null;

    const current = q.current as number;
    const percent = (q.percent as number) ?? 0;
    const lastClose = typeof q.last_close === "number" ? q.last_close : current / (1 + percent / 100);
    const quoteTs = typeof q.timestamp === "number" ? q.timestamp : Date.now();

    const result: QuoteResult = {
      ticker,
      name: (q.name as string) ?? ticker,
      price: current,
      prevClose: lastClose,
      open: (q.open as number) ?? current,
      high: (q.high as number) ?? current,
      low: (q.low as number) ?? current,
      volume: (q.volume as number) ?? 0,
      turnover: (q.amount as number) ?? 0,
      changePct: percent,
      quoteTime: quoteTs,
      pe_ttm: typeof q.pe_ttm === "number" ? q.pe_ttm : null,
      pb: typeof q.pb === "number" ? q.pb : null,
      market_capital: typeof q.market_capital === "number" ? q.market_capital : null,
      float_market_capital: typeof q.float_market_capital === "number" ? q.float_market_capital : null,
      turnover_rate: typeof q.turnover_rate === "number" ? q.turnover_rate : null,
      dividend_yield: typeof q.dividend_yield === "number" ? q.dividend_yield : null,
      total_shares: typeof q.total_shares === "number" ? q.total_shares : null,
    };
    cacheSet(key, result, isTradingTime() ? 15_000 : 60_000);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

const BATCH_SIZE = 40;

export async function getBatchQuotes(tickers: string[], nameMap?: Map<string, string>): Promise<Map<string, QuoteResult>> {
  const result = new Map<string, QuoteResult>();
  const uncached: string[] = [];

  for (const t of tickers) {
    const cached = cacheGet<QuoteResult>(`quote:${t}`);
    if (cached) result.set(t, cached);
    else uncached.push(t);
  }
  if (uncached.length === 0) return result;

  const cookie = await getSessionCookie();
  if (!cookie) return result;

  const ttl = isTradingTime() ? 15_000 : 60_000;

  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const symbols = batch.map(normalizeTickerToXueqiu).join(",");
    try {
      const resp = await fetch(
        `https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${symbols}`,
        { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://xueqiu.com/" } },
      );
      if (!resp.ok) continue;
      const body = await resp.json() as { data?: Array<Record<string, unknown>> };
      for (const q of body.data ?? []) {
        const sym = q.symbol as string;
        const ticker = denormalizeXueqiuTicker(sym);
        const current = q.current as number;
        const quote: QuoteResult = {
          ticker,
          name: nameMap?.get(ticker) ?? ticker,
          price: current,
          prevClose: (q.last_close as number) ?? current,
          open: (q.open as number) ?? current,
          high: (q.high as number) ?? current,
          low: (q.low as number) ?? current,
          volume: (q.volume as number) ?? 0,
          turnover: (q.amount as number) ?? 0,
          changePct: (q.percent as number) ?? 0,
          quoteTime: (q.timestamp as number) ?? Date.now(),
          pe_ttm: typeof q.pe_ttm === "number" ? q.pe_ttm : null,
          pb: typeof q.pb === "number" ? q.pb : null,
          market_capital: typeof q.market_capital === "number" ? q.market_capital : null,
          float_market_capital: typeof q.float_market_capital === "number" ? q.float_market_capital : null,
          turnover_rate: typeof q.turnover_rate === "number" ? q.turnover_rate : null,
          dividend_yield: typeof q.dividend_yield === "number" ? q.dividend_yield : null,
          total_shares: typeof q.total_shares === "number" ? q.total_shares : null,
        };
        cacheSet(`quote:${ticker}`, quote, ttl);
        result.set(ticker, quote);
      }
    } catch { /* skip failed batch */ }
  }
  return result;
}

function denormalizeXueqiuTicker(symbol: string): string {
  return symbol.slice(2);
}

export interface PankouLevel {
  price: number;
  volume: number;
}

export interface PankouData {
  ticker: string;
  current: number;
  bids: PankouLevel[];
  asks: PankouLevel[];
}

export async function getPankou(ticker: string): Promise<PankouData | null> {
  const key = `pankou:${ticker}`;
  const cached = cacheGet<PankouData>(key);
  if (cached) return cached;

  const cookie = await getSessionCookie();
  if (!cookie) return null;

  const symbol = normalizeTickerToXueqiu(ticker);
  try {
    const resp = await fetch(
      `https://stock.xueqiu.com/v5/stock/realtime/pankou.json?symbol=${symbol}`,
      { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://xueqiu.com/" } },
    );
    if (!resp.ok) return null;
    const body = await resp.json() as { data?: Record<string, unknown> };
    const d = body.data;
    if (!d) return null;

    const bids: PankouLevel[] = [];
    const asks: PankouLevel[] = [];
    for (let i = 1; i <= 5; i++) {
      const bp = d[`bp${i}`] as number | null;
      const bc = d[`bc${i}`] as number | null;
      if (bp != null && bc != null) bids.push({ price: bp, volume: bc });
      const sp = d[`sp${i}`] as number | null;
      const sc = d[`sc${i}`] as number | null;
      if (sp != null && sc != null) asks.push({ price: sp, volume: sc });
    }

    const result: PankouData = { ticker, current: (d.current as number) ?? 0, bids, asks };
    cacheSet(key, result, isTradingTime() ? 5_000 : 60_000);
    return result;
  } catch {
    return null;
  }
}

export async function getMinuteChart(ticker: string): Promise<MinutePoint[]> {
  const key = `minute:${ticker}`;
  const cached = cacheGet<MinutePoint[]>(key);
  if (cached) return cached;

  const cookie = await getSessionCookie();
  if (!cookie) return [];

  const symbol = normalizeTickerToXueqiu(ticker);
  try {
    const resp = await fetch(
      `https://stock.xueqiu.com/v5/stock/chart/minute.json?symbol=${symbol}&period=1d`,
      { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://xueqiu.com/" } },
    );
    if (!resp.ok) return [];
    const body = await resp.json() as { data?: { items?: Record<string, unknown>[] } };
    const result = (body.data?.items ?? []).map(it => ({
      timestamp: it.timestamp as number,
      price: it.current as number,
      volume: it.volume as number,
      avgPrice: it.avg_price as number,
      percent: it.percent as number,
    }));
    if (result.length > 0) cacheSet(key, result, minuteTtl());
    return result;
  } catch {
    return [];
  }
}

export interface TradeTickItem {
  timestamp: number;
  price: number;
  volume: number;
  side: "B" | "S" | "N";
  percent: number;
}

export async function getTradeTicks(ticker: string, count = 30): Promise<TradeTickItem[]> {
  const key = `ticks:${ticker}`;
  const cached = cacheGet<TradeTickItem[]>(key);
  if (cached) return cached;

  const cookie = await getSessionCookie();
  if (!cookie) return [];

  const symbol = normalizeTickerToXueqiu(ticker);
  try {
    const resp = await fetch(
      `https://stock.xueqiu.com/v5/stock/history/trade.json?symbol=${symbol}&count=${count}`,
      { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://xueqiu.com/" } },
    );
    if (!resp.ok) return [];
    const body = await resp.json() as { data?: { items?: { timestamp: number; current: number; trade_volume: number; side: number; percent: number }[] } };
    const result = (body.data?.items ?? []).map(it => ({
      timestamp: it.timestamp,
      price: it.current,
      volume: it.trade_volume,
      side: (it.side === 1 ? "B" : it.side === -1 ? "S" : "N") as "B" | "S" | "N",
      percent: it.percent,
    }));
    if (result.length > 0) cacheSet(key, result, isTradingTime() ? 5_000 : 60_000);
    return result;
  } catch {
    return [];
  }
}

export async function getKlineChart(ticker: string, period = "day", count = 60): Promise<KlinePoint[]> {
  const key = `kline:${ticker}:${period}:${count}`;
  const cached = cacheGet<KlinePoint[]>(key);
  if (cached) return cached;

  const cookie = await getSessionCookie();
  if (!cookie) return [];

  const symbol = normalizeTickerToXueqiu(ticker);
  try {
    const resp = await fetch(
      `https://stock.xueqiu.com/v5/stock/chart/kline.json?symbol=${symbol}&begin=${Date.now()}&period=${period}&type=before&count=-${count}`,
      { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://xueqiu.com/" } },
    );
    if (!resp.ok) return [];
    const body = await resp.json() as { data?: { column?: string[]; item?: unknown[][] } };
    const columns = body.data?.column ?? [];
    const items = body.data?.item ?? [];
    const idx = (n: string) => columns.indexOf(n);

    const result = items.map(row => ({
      timestamp: row[idx("timestamp")] as number,
      open: row[idx("open")] as number,
      close: row[idx("close")] as number,
      high: row[idx("high")] as number,
      low: row[idx("low")] as number,
      volume: row[idx("volume")] as number,
      amount: (row[idx("amount")] as number) ?? 0,
      percent: (row[idx("percent")] as number) ?? 0,
      turnoverRate: (row[idx("turnoverrate")] as number) ?? 0,
    }));
    if (result.length > 0) cacheSet(key, result, klineTtl(period));
    return result;
  } catch {
    return [];
  }
}

// ── Major indices ──

export interface IndexQuote {
  code: string;
  name: string;
  value: number;
  chg: number;
  chgPct: number;
}

const MAJOR_INDICES = [
  { code: "SH000001", name: "上证指数" },
  { code: "SZ399001", name: "深证成指" },
  { code: "SZ399006", name: "创业板指" },
  { code: "SH000688", name: "科创50" },
  { code: "BJ899050", name: "北证50" },
];

export async function getIndexQuotes(): Promise<IndexQuote[]> {
  const key = "indices:major";
  const cached = cacheGet<IndexQuote[]>(key);
  if (cached) return cached;

  const cookie = await getSessionCookie();
  if (!cookie) return [];

  const symbols = MAJOR_INDICES.map(i => i.code).join(",");
  try {
    const resp = await fetch(
      `https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${symbols}`,
      { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://xueqiu.com/" } },
    );
    if (!resp.ok) return [];
    const body = await resp.json() as { data?: Array<Record<string, unknown>> };
    const result: IndexQuote[] = [];
    for (const meta of MAJOR_INDICES) {
      const q = (body.data ?? []).find(d => d.symbol === meta.code);
      if (!q || typeof q.current !== "number") continue;
      const current = q.current as number;
      const lastClose = typeof q.last_close === "number" ? q.last_close : current;
      result.push({
        code: meta.code,
        name: meta.name,
        value: current,
        chg: +(current - lastClose).toFixed(2),
        chgPct: +((current - lastClose) / lastClose * 100).toFixed(2),
      });
    }
    cacheSet(key, result, isTradingTime() ? 15_000 : 60_000);
    return result;
  } catch {
    return [];
  }
}
