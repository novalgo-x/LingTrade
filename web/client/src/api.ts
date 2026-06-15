import type { Stock, ReportSummary, ReportFull, AnalysisTask, StageRow } from "./types.js";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  listStocks: (search?: string) =>
    request<Stock[]>(`/stocks${search ? `?search=${encodeURIComponent(search)}` : ""}`),

  createStock: (ticker: string, name?: string, notes?: string) =>
    request<Stock>("/stocks", {
      method: "POST",
      body: JSON.stringify({ ticker, name, notes }),
    }),

  backfillStocks: () =>
    request<{ updated: number; total: number }>("/stocks/backfill", { method: "POST" }),

  updateStock: (id: number, fields: { name?: string; notes?: string }) =>
    request<Stock>(`/stocks/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    }),

  deleteStock: (id: number) =>
    request<void>(`/stocks/${id}`, { method: "DELETE" }),

  startAnalysis: (stockId: number, options?: { dryRun?: boolean; verbose?: boolean }) =>
    request<{ taskId: number }>(`/stocks/${stockId}/analyze`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }),

  getTask: (taskId: number) => request<AnalysisTask>(`/tasks/${taskId}`),

  getRunningTask: (stockId: number) =>
    request<{ taskId: number | null; startedAt?: string }>(`/stocks/${stockId}/running-task`),

  getLatestTask: (stockId: number) =>
    request<{ taskId: number | null; status?: string }>(`/stocks/${stockId}/latest-task`),

  getActiveTasks: () =>
    request<Array<{ taskId: number; stockId: number }>>("/tasks/active"),

  getLatestTasks: () =>
    request<Array<{ taskId: number; stockId: number; status: string; completedAt: string | null }>>("/tasks/latest"),

  getTaskStages: (taskId: number) =>
    request<StageRow[]>(`/tasks/${taskId}/stages`),

  retryTask: (taskId: number) =>
    request<{ taskId: number; retried: boolean }>(`/tasks/${taskId}/retry`, { method: "POST" }),

  cancelTask: (taskId: number) =>
    request<{ cancelled: boolean }>(`/tasks/${taskId}/cancel`, { method: "POST" }),

  listReports: (stockId: number) =>
    request<ReportSummary[]>(`/stocks/${stockId}/reports`),

  getLatestReports: () =>
    request<ReportSummary[]>("/reports/latest"),

  getReport: (reportId: number) => request<ReportFull>(`/reports/${reportId}`),

  deleteReport: (reportId: number) =>
    request<void>(`/reports/${reportId}`, { method: "DELETE" }),

  startBatchAnalysis: () =>
    request<{ started: boolean }>("/batch-analyze", { method: "POST" }),

  getBatchStatus: () =>
    request<{
      running: boolean; total: number; completed: number; failed: number;
      current: { ticker: string; name: string; attempt: number } | null;
      results: Array<{ ticker: string; name: string; status: string; error?: string; attempts: number }>;
    }>("/batch-analyze/status"),

  cancelBatchAnalysis: () =>
    request<{ cancelled: boolean }>("/batch-analyze/cancel", { method: "POST" }),
};
