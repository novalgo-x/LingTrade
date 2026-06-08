import type { SimAccount, SimPosition, SimOrder, SimDecision, SimPerformance, SchedulerStatus, SimConfig, KbFile, KbFileDetail, KbStats, IndexQuote, DashReportSummary } from "./types";

const BASE = "/api/sim";
const DEFAULT_TIMEOUT = 20_000;

async function get<T>(path: string, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export const simApi = {
  getAccount: () => get<SimAccount>("/account"),
  getNavHistory: () => get<{ date: string; nav: number }[]>("/nav/history"),
  getPositions: () => get<SimPosition[]>("/positions"),
  getOrders: (params?: { limit?: number; offset?: number; side?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.side) qs.set("side", params.side);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return get<{ data: SimOrder[]; total: number }>(`/orders${q ? "?" + q : ""}`);
  },
  getDecisions: (params?: { limit?: number; offset?: number; action?: string; date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.action) qs.set("action", params.action);
    if (params?.date) qs.set("date", params.date);
    const q = qs.toString();
    return get<{ data: SimDecision[]; total: number }>(`/decisions${q ? "?" + q : ""}`);
  },
  getDecision: (id: number) => get<SimDecision>(`/decisions/${id}`),
  getPerformance: () => get<SimPerformance>("/performance"),
  getConfig: () => get<SimConfig>("/config"),
  setConfig: (entries: Record<string, unknown>) => put<SimConfig>("/config", entries),
  getSchedulerStatus: () => get<SchedulerStatus>("/scheduler/status"),
  startScheduler: () => post<SchedulerStatus>("/scheduler/start"),
  stopScheduler: () => post<SchedulerStatus>("/scheduler/stop"),
  runOnce: (force = false) => post<{ success: boolean }>("/run-once", { force }),
  resetAccount: (initialBalance?: number) => post<{ success: boolean }>("/account/reset", initialBalance ? { initialBalance } : undefined),
  clearDecisions: () => post<{ success: boolean }>("/account/clear-decisions"),
  getMarketState: () => get<{ state: string }>("/market/state"),
  getQuote: (ticker: string) => get<Record<string, unknown>>(`/market/quote/${ticker}`),
  getBatchQuotes: (tickers: string[]) => get<Record<string, Record<string, unknown>>>(`/market/quotes?symbols=${tickers.join(",")}`),
  getPankou: (ticker: string) => get<{ ticker: string; current: number; bids: { price: number; volume: number }[]; asks: { price: number; volume: number }[] }>(`/market/pankou/${ticker}`),
  getMinuteChart: (ticker: string) => get<{ timestamp: number; price: number; volume: number; avgPrice: number; percent: number }[]>(`/market/minute/${ticker}`),
  getKlineChart: (ticker: string, period = "day", count = 60) => {
    const qs = new URLSearchParams({ period, count: String(count) });
    return get<{ timestamp: number; open: number; close: number; high: number; low: number; volume: number; amount: number; percent: number; turnoverRate: number }[]>(`/market/kline/${ticker}?${qs}`);
  },
  getTicks: (ticker: string, count = 30) => get<{ timestamp: number; price: number; volume: number; side: "B" | "S" | "N"; percent: number }[]>(`/market/ticks/${ticker}?count=${count}`),
  getIndices: () => get<IndexQuote[]>("/market/indices"),
  getLatestReports: () => fetch("/api/reports/latest").then(r => r.ok ? r.json() as Promise<DashReportSummary[]> : []),
  getTushare: () => get<{ token: string; rawToken: string; baseUrl: string; verified: boolean }>("/tushare"),
  testTushare: (token: string, baseUrl?: string) => post<{ ok: boolean; latency?: number; error?: string }>("/tushare/test", { token, baseUrl }),
  saveTushare: (token: string, baseUrl?: string) => post<{ ok: boolean }>("/tushare/save", { token, baseUrl }),
  getXueqiu: () => get<{ cookie: string; mode: string }>("/xueqiu"),
  testXueqiu: (cookie?: string) => post<{ ok: boolean; latency?: number; mode?: string; error?: string }>("/xueqiu/test", { cookie }),
  saveXueqiu: (cookie: string) => post<{ ok: boolean }>("/xueqiu/save", { cookie }),
  getLlmStatus: () => get<{ configured: boolean }>("/llm/status"),
  testLlm: (apiKey: string, baseUrl: string, model?: string, id?: string) =>
    post<{ ok: boolean; latency?: number; error?: string }>("/llm/test", { apiKey, baseUrl, model, id }),
  fetchLlmModels: (apiKey: string, baseUrl: string) =>
    post<{ models: string[] }>("/llm/models", { apiKey, baseUrl }),
  saveLlmProvider: (id: string, key: string, baseUrl: string, enabled: boolean) =>
    post<{ ok: boolean }>("/llm/save", { id, key, baseUrl, enabled }),
  saveLlmRoles: (roles: Record<string, { provider: string; model: string }>) =>
    post<{ ok: boolean }>("/llm/roles/save", { roles }),
};

// ── Knowledge Base API ──

const KB_BASE = "/api/kb";

async function kbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${KB_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export const kbApi = {
  upload: (file: File, source?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (source) form.append("source", source);
    return fetch(`${KB_BASE}/upload`, { method: "POST", body: form })
      .then(r => { if (!r.ok) throw new Error(`Upload failed: ${r.status}`); return r.json() as Promise<{ id: number; filename: string; originalName: string; status: string }>; });
  },
  getFiles: () => kbGet<KbFile[]>("/files"),
  getFile: (id: number) => kbGet<KbFileDetail>(`/files/${id}`),
  deleteFile: (id: number) => fetch(`${KB_BASE}/files/${id}`, { method: "DELETE" }),
  getStats: () => kbGet<KbStats>("/stats"),
  reprocess: (id: number) => fetch(`${KB_BASE}/files/${id}/reprocess`, { method: "POST" })
    .then(r => { if (!r.ok) throw new Error(`Reprocess failed: ${r.status}`); return r.json(); }),
};
