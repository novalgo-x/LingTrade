import { spawn, type ChildProcess } from "node:child_process";
import type { Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/connection.js";
import { createReport } from "./reportService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

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
const activeProcesses = new Map<number, ChildProcess>();

export function cleanupStaleTasks(): void {
  const db = getDb();
  const stale = db
    .prepare("UPDATE analysis_tasks SET status = 'failed', error_message = 'Server restarted while task was running', completed_at = ? WHERE status = 'running'")
    .run(new Date().toISOString());
  if (stale.changes > 0) {
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
    const proc = activeProcesses.get(row.id);
    if (proc) proc.kill("SIGTERM");
    finishTask(row.id, "failed", "Task timed out (stale cleanup)");
    activeProcesses.delete(row.id);
    return undefined;
  }
  return row;
}

export function hasRunningTask(stockId: number): boolean {
  return getRunningTask(stockId) !== undefined;
}

export function startAnalysis(
  stockId: number,
  ticker: string,
  options?: { dryRun?: boolean; verbose?: boolean }
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const args = ["analyze", ticker];
  if (options?.dryRun) {
    args.push("--dry-run");
  } else {
    args.push("--real-data");
  }
  if (options?.verbose !== false) {
    args.push("--verbose");
  }
  args.push("--save-raw-data");

  const result = db
    .prepare("INSERT INTO analysis_tasks (stock_id, status, cli_args, started_at) VALUES (?, 'running', ?, ?)")
    .run(stockId, JSON.stringify(args), now);

  const taskId = Number(result.lastInsertRowid);
  taskLogs.set(taskId, []);

  spawnCli(taskId, stockId, args);

  return taskId;
}

function spawnCli(taskId: number, stockId: number, args: string[]): void {
  const child: ChildProcess = spawn(
    "npx",
    ["tsx", "src/cli.ts", ...args],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }
  );

  activeProcesses.set(taskId, child);

  let stdout = "";

  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    activeProcesses.delete(taskId);
    finishTask(taskId, "failed", "Analysis timed out after 30 minutes");
    broadcastEvent(taskId, "error", { message: "Analysis timed out after 30 minutes" });
  }, TIMEOUT_MS);

  child.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      const logEntry = line;
      const logs = taskLogs.get(taskId);
      if (logs) logs.push(logEntry);
      broadcastEvent(taskId, "log", {
        timestamp: new Date().toISOString(),
        message: logEntry,
      });
    }
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    activeProcesses.delete(taskId);

    if (code === 0 && stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        const report = createReport(taskId, stockId, JSON.stringify(parsed));
        finishTask(taskId, "completed", null);
        broadcastEvent(taskId, "status", {
          status: "completed",
          reportId: report.id,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to parse CLI output";
        finishTask(taskId, "failed", msg);
        broadcastEvent(taskId, "error", { message: msg });
      }
    } else {
      const msg = `CLI process exited with code ${code}`;
      finishTask(taskId, "failed", msg);
      broadcastEvent(taskId, "error", { message: msg });
    }
  });
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
  for (const [taskId, child] of activeProcesses) {
    child.kill("SIGTERM");
    finishTask(taskId, "failed", "Cancelled by user");
    activeProcesses.delete(taskId);
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
