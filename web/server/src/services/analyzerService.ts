import type { Response } from "express";
import { getDb } from "../db/connection.js";
import { createReport } from "./reportService.js";
import { buildEngine } from "./runtimeConfig.js";
import { loadReadyInsights } from "./kbService.js";
import { InvestmentWorkflow } from "../../../../src/workflow/investmentWorkflow.js";
import {
  WorkflowAbortError,
  type StageEvent,
  type StageEmitter,
  type StageId,
  type WorkflowContext,
} from "../../../../src/workflow/stageEvents.js";
import {
  recordStageStart,
  recordStageDone,
  recordStageFailed,
  buildResumeContext,
  pruneStageResults,
  clearStageResults,
  getStages,
  type StageRow,
} from "./stageResultService.js";

const TIMEOUT_MS = 30 * 60 * 1000;

interface TaskRow {
  id: number;
  stock_id: number;
  status: string;
  cli_args: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

const taskLogs = new Map<number, string[]>();
const taskSubscribers = new Map<number, Set<Response>>();
const activeRuns = new Map<number, AbortController>();

export function cleanupStaleTasks(): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stale = db
    .prepare("UPDATE analysis_tasks SET status = 'failed', error_message = 'Server restarted while task was running', completed_at = ? WHERE status = 'running'")
    .run(now);
  if (stale.changes > 0) {
    db.prepare("UPDATE analysis_stage_results SET status = 'failed', ended_at = ? WHERE status = 'running'").run(now);
    console.log(`[Analyzer] Cleaned up ${stale.changes} stale running task(s)`);
  }
}

export function getTask(taskId: number): TaskRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM analysis_tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
}

export function getRunningTask(stockId: number): TaskRow | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM analysis_tasks WHERE stock_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1")
    .get(stockId) as TaskRow | undefined;
  if (!row) return undefined;

  const elapsed = Date.now() - new Date(row.started_at!).getTime();
  if (elapsed > TIMEOUT_MS) {
    activeRuns.get(row.id)?.abort();
    finishTask(row.id, "failed", "Task timed out (stale cleanup)");
    activeRuns.delete(row.id);
    return undefined;
  }
  return row;
}

export function hasRunningTask(stockId: number): boolean {
  return getRunningTask(stockId) !== undefined;
}

/** 当前所有运行中的任务（含批量正在跑的那只），供前端在列表里标出"生成中"的股票。 */
export function getActiveTasks(): Array<{ taskId: number; stockId: number }> {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, stock_id FROM analysis_tasks WHERE status = 'running'")
    .all() as Array<{ id: number; stock_id: number }>;
  return rows.map((r) => ({ taskId: r.id, stockId: r.stock_id }));
}

/** 该股最近一个任务（任意状态），供前端刷新后恢复运行中/失败的进度入口。 */
export function getLatestTask(stockId: number): { taskId: number | null; status?: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT id, status FROM analysis_tasks WHERE stock_id = ? ORDER BY id DESC LIMIT 1")
    .get(stockId) as { id: number; status: string } | undefined;
  return row ? { taskId: row.id, status: row.status } : { taskId: null };
}

/** 每股最近一个任务的状态（任意状态），供列表「未读 / 失败」标记批量判定。 */
export function getLatestTasksForAllStocks(): Array<{ stockId: number; taskId: number; status: string; completedAt: string | null }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.id, t.stock_id, t.status, t.completed_at
       FROM analysis_tasks t
       INNER JOIN (
         SELECT stock_id, MAX(id) AS max_id FROM analysis_tasks GROUP BY stock_id
       ) latest ON t.stock_id = latest.stock_id AND t.id = latest.max_id`,
    )
    .all() as Array<{ id: number; stock_id: number; status: string; completed_at: string | null }>;
  return rows.map((r) => ({ stockId: r.stock_id, taskId: r.id, status: r.status, completedAt: r.completed_at }));
}

export function getTaskStages(taskId: number): StageRow[] {
  return getStages(taskId);
}

export function startAnalysis(
  stockId: number,
  ticker: string,
  options?: { dryRun?: boolean; verbose?: boolean },
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const args = ["analyze", ticker, options?.dryRun ? "--dry-run" : "--real-data"];

  const result = db
    .prepare("INSERT INTO analysis_tasks (stock_id, status, cli_args, started_at) VALUES (?, 'running', ?, ?)")
    .run(stockId, JSON.stringify(args), now);

  const taskId = Number(result.lastInsertRowid);
  taskLogs.set(taskId, []);
  clearStageResults(taskId);

  void executeRun(taskId, stockId, ticker, { dryRun: options?.dryRun });
  return taskId;
}

/** 从失败阶段续跑：复用已完成阶段的缓存结果，无需从头重跑。 */
export function retryTask(taskId: number): { ok: boolean; error?: string } {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.status === "running") return { ok: false, error: "Task already running" };

  const stock = db.prepare("SELECT ticker FROM stocks WHERE id = ?").get(task.stock_id) as { ticker: string } | undefined;
  if (!stock) return { ok: false, error: "Stock not found" };

  let dryRun = false;
  try {
    dryRun = (JSON.parse(task.cli_args) as string[]).includes("--dry-run");
  } catch { /* 保持默认 */ }

  const now = new Date().toISOString();
  db.prepare("UPDATE analysis_tasks SET status = 'running', error_message = NULL, completed_at = NULL, started_at = ? WHERE id = ?").run(now, taskId);
  taskLogs.set(taskId, []);

  void executeRun(taskId, task.stock_id, stock.ticker, { resume: true, dryRun });
  return { ok: true };
}

/** 取消正在运行的单个任务（中断在途的 LLM / 数据请求）。 */
export function cancelTask(taskId: number): { ok: boolean } {
  const controller = activeRuns.get(taskId);
  if (!controller) return { ok: false };
  controller.abort();
  return { ok: true };
}

async function executeRun(
  taskId: number,
  stockId: number,
  ticker: string,
  opts: { dryRun?: boolean | undefined; resume?: boolean | undefined },
): Promise<void> {
  const controller = new AbortController();
  activeRuns.set(taskId, controller);
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const emit: StageEmitter = (ev) => {
    const cumulativeMs = persistStageEvent(taskId, ev);
    // done/failed 广播「累计耗时」，保证实时流与刷新后从 DB 还原的用时一致
    const outEv: StageEvent =
      cumulativeMs != null && (ev.kind === "stage_done" || ev.kind === "stage_failed")
        ? { ...ev, durationMs: cumulativeMs }
        : ev;
    const line = formatLogLine(outEv);
    taskLogs.get(taskId)?.push(line);
    broadcastEvent(taskId, "log", { timestamp: outEv.at, message: line });
    broadcastEvent(taskId, "stage", outEv);
  };

  try {
    const { llm, dataSource } = buildEngine({ dryRun: opts.dryRun });
    const kbInsights = loadReadyInsights();
    const workflow = new InvestmentWorkflow(dataSource, llm, undefined, undefined, kbInsights);

    let resumeArg: { resumeCtx?: WorkflowContext; fromStage?: StageId } = {};
    if (opts.resume) {
      const { ctx, fromStage } = buildResumeContext(taskId);
      if (fromStage) resumeArg = { resumeCtx: ctx, fromStage };
    }

    const result = await workflow.runStaged({ ticker, emit, signal: controller.signal, ...resumeArg });

    const report = createReport(taskId, stockId, JSON.stringify(result));
    pruneStageResults(taskId);
    finishTask(taskId, "completed", null);
    broadcastEvent(taskId, "status", { status: "completed", reportId: report.id });
  } catch (err) {
    const aborted = controller.signal.aborted || err instanceof WorkflowAbortError;
    const message = aborted ? "分析已取消" : err instanceof Error ? err.message : String(err);
    finishTask(taskId, "failed", message);
    broadcastEvent(taskId, "error", { message });
  } finally {
    clearTimeout(timer);
    activeRuns.delete(taskId);
  }
}

/** 持久化阶段事件；对 done/failed 返回该阶段累计耗时（供 SSE 广播累计值，与刷新后 seed 一致）。 */
function persistStageEvent(taskId: number, ev: StageEvent): number | undefined {
  switch (ev.kind) {
    case "stage_start":
      recordStageStart(taskId, ev.stage, ev.index);
      return undefined;
    case "stage_done":
      return recordStageDone(taskId, ev.stage, ev.index, ev.summary, ev.durationMs, ev.payload, ev.skipped);
    case "stage_failed":
      return recordStageFailed(taskId, ev.stage, ev.index, ev.error, ev.durationMs);
    case "substep":
      return undefined; // 瞬时事件，不持久化
  }
}

function formatLogLine(ev: StageEvent): string {
  switch (ev.kind) {
    case "stage_start":
      return `▶ ${ev.stage}`;
    case "substep":
      return `   - ${ev.side ? `[${ev.side}] ` : ""}${ev.text}`;
    case "stage_done":
      return `✓ ${ev.stage} (${(ev.durationMs / 1000).toFixed(1)}s)${ev.skipped ? " [跳过]" : ""}${ev.summary ? ` ${ev.summary}` : ""}`;
    case "stage_failed":
      return `✗ ${ev.stage}: ${ev.error}`;
  }
}

/** 从 stage result_json 或 report 中恢复 debate 多空论点，用于重连时重建 substep 事件。 */
function loadDebateArgs(taskId: number, stageResultJson: string | null): { bull: string[]; bear: string[] } | null {
  const extract = (obj: Record<string, unknown>): { bull: string[]; bear: string[] } | null => {
    const bc = obj.bullCase as Record<string, unknown> | undefined;
    const ec = obj.bearCase as Record<string, unknown> | undefined;
    if (!bc && !ec) return null;
    return {
      bull: (Array.isArray(bc?.coreArguments) ? bc.coreArguments as string[] : []).slice(0, 3),
      bear: (Array.isArray(ec?.coreArguments) ? ec.coreArguments as string[] : []).slice(0, 3),
    };
  };
  if (stageResultJson) {
    try { return extract(JSON.parse(stageResultJson)); } catch { /* fall through */ }
  }
  const db = getDb();
  const report = db.prepare("SELECT result_json FROM reports WHERE task_id = ? LIMIT 1").get(taskId) as { result_json: string } | undefined;
  if (report?.result_json) {
    try { return extract(JSON.parse(report.result_json)); } catch { /* fall through */ }
  }
  return null;
}

/** 由持久化的阶段行重建结构化事件，用于 SSE 重连时还原时间线。 */
function replayStageEvents(taskId: number): StageEvent[] {
  const events: StageEvent[] = [];
  for (const row of getStages(taskId)) {
    const at = row.ended_at ?? row.started_at ?? new Date().toISOString();
    events.push({ kind: "stage_start", stage: row.stage, index: row.stage_index, at: row.started_at ?? at });
    if (row.stage === "debate_complete" && row.status === "done") {
      const args = loadDebateArgs(taskId, row.result_json);
      if (args) {
        for (const t of args.bull) events.push({ kind: "substep", stage: row.stage, text: t, side: "bull", at });
        for (const t of args.bear) events.push({ kind: "substep", stage: row.stage, text: t, side: "bear", at });
      }
    }
    if (row.status === "done" || row.status === "skipped") {
      events.push({
        kind: "stage_done",
        stage: row.stage,
        index: row.stage_index,
        summary: row.summary ?? "",
        durationMs: row.duration_ms ?? 0,
        skipped: row.status === "skipped",
        at,
      });
    } else if (row.status === "failed") {
      events.push({
        kind: "stage_failed",
        stage: row.stage,
        index: row.stage_index,
        error: row.summary ?? "失败",
        durationMs: row.duration_ms ?? 0,
        at,
      });
    }
  }
  return events;
}

function finishTask(taskId: number, status: "completed" | "failed", errorMessage: string | null): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE analysis_tasks SET status = ?, error_message = ?, completed_at = ? WHERE id = ?")
    .run(status, errorMessage, now, taskId);
}

function broadcastEvent(taskId: number, event: string, data: unknown): void {
  const subscribers = taskSubscribers.get(taskId);
  if (!subscribers) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    res.write(payload);
    if (event === "status" || event === "error") {
      res.end();
    }
  }
  if (event === "status" || event === "error") {
    taskSubscribers.delete(taskId);
  }
}

export function subscribeToLogs(taskId: number, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const logs = taskLogs.get(taskId) ?? [];
  for (const message of logs) {
    res.write(`event: log\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), message })}\n\n`);
  }

  for (const ev of replayStageEvents(taskId)) {
    res.write(`event: stage\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  const task = getTask(taskId);
  if (task && (task.status === "completed" || task.status === "failed")) {
    if (task.status === "completed") {
      const db = getDb();
      const report = db.prepare("SELECT id FROM reports WHERE task_id = ? LIMIT 1").get(taskId) as { id: number } | undefined;
      res.write(`event: status\ndata: ${JSON.stringify({ status: "completed", reportId: report?.id ?? null })}\n\n`);
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: task.error_message ?? "Unknown error" })}\n\n`);
    }
    res.end();
    return;
  }

  let subscribers = taskSubscribers.get(taskId);
  if (!subscribers) {
    subscribers = new Set();
    taskSubscribers.set(taskId, subscribers);
  }
  subscribers.add(res);

  res.on("close", () => {
    subscribers!.delete(res);
    if (subscribers!.size === 0) {
      taskSubscribers.delete(taskId);
    }
  });
}

// --- Batch Analysis ---

export interface BatchStatus {
  running: boolean;
  total: number;
  completed: number;
  failed: number;
  current: { ticker: string; name: string; attempt: number } | null;
  results: Array<{ ticker: string; name: string; status: "completed" | "failed" | "pending" | "running"; error?: string; attempts: number }>;
}

let batchState: BatchStatus = { running: false, total: 0, completed: 0, failed: 0, current: null, results: [] };
let batchCancelled = false;

export function getBatchStatus(): BatchStatus {
  return batchState;
}

export function cancelBatch(): void {
  batchCancelled = true;
  for (const [taskId, controller] of activeRuns) {
    controller.abort();
    finishTask(taskId, "failed", "Cancelled by user");
    activeRuns.delete(taskId);
  }
  batchState.running = false;
  batchState.current = null;
}

function runAnalysisAsync(stockId: number, ticker: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const taskId = startAnalysis(stockId, ticker);

    const check = setInterval(() => {
      if (batchCancelled) { clearInterval(check); resolve({ success: false, error: "Cancelled" }); return; }
      const task = getTask(taskId);
      if (!task) { clearInterval(check); resolve({ success: false, error: "Task disappeared" }); return; }
      if (task.status === "completed") { clearInterval(check); resolve({ success: true }); }
      else if (task.status === "failed") { clearInterval(check); resolve({ success: false, error: task.error_message ?? "Unknown error" }); }
    }, 2000);
  });
}

export async function startBatchAnalysis(): Promise<void> {
  if (batchState.running) return;

  const db = getDb();
  const stocks = db.prepare("SELECT id, ticker, name FROM stocks").all() as Array<{ id: number; ticker: string; name: string }>;

  batchCancelled = false;
  batchState = {
    running: true, total: stocks.length, completed: 0, failed: 0, current: null,
    results: stocks.map(s => ({ ticker: s.ticker, name: s.name, status: "pending" as const, attempts: 0 })),
  };

  const MAX_RETRIES = 3;

  for (let i = 0; i < stocks.length; i++) {
    if (batchCancelled) {
      console.log(`[Batch] Cancelled at ${i + 1}/${stocks.length}`);
      break;
    }

    const stock = stocks[i]!;
    let success = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (batchCancelled) break;

      batchState.current = { ticker: stock.ticker, name: stock.name, attempt };
      batchState.results[i]!.status = "running";
      batchState.results[i]!.attempts = attempt;
      console.log(`[Batch] ${stock.ticker} ${stock.name} (${i + 1}/${stocks.length}, attempt ${attempt}/${MAX_RETRIES})`);

      const result = await runAnalysisAsync(stock.id, stock.ticker);

      if (result.success) {
        success = true;
        batchState.results[i]!.status = "completed";
        batchState.completed++;
        console.log(`[Batch] ${stock.ticker} completed`);
        break;
      }

      console.log(`[Batch] ${stock.ticker} failed (attempt ${attempt}): ${result.error}`);
      batchState.results[i]!.error = result.error;

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!success && !batchCancelled) {
      batchState.results[i]!.status = "failed";
      batchState.failed++;
    }
  }

  batchState.running = false;
  batchState.current = null;
  console.log(`[Batch] Done: ${batchState.completed} completed, ${batchState.failed} failed`);
}
