import { getDb } from "../db/connection.js";
import {
  STAGE_ORDER,
  applyStageResult,
  type StageId,
  type WorkflowContext,
} from "../../../../src/workflow/stageEvents.js";

export type StageStatus = "running" | "done" | "failed" | "skipped";

export interface StageRow {
  id: number;
  task_id: number;
  stage: StageId;
  stage_index: number;
  status: StageStatus;
  summary: string | null;
  result_json: string | null;
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
}

export function recordStageStart(taskId: number, stage: StageId, index: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO analysis_stage_results (task_id, stage, stage_index, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
    ON CONFLICT(task_id, stage) DO UPDATE SET
      status = 'running', stage_index = excluded.stage_index, started_at = excluded.started_at,
      summary = NULL, result_json = NULL, ended_at = NULL
  `).run(taskId, stage, index, now);
  // 注意：重试续跑时刻意保留 duration_ms（该阶段累计耗时），让用时从失败点接着累计而非归零
}

export function recordStageDone(
  taskId: number,
  stage: StageId,
  index: number,
  summary: string,
  durationMs: number,
  payload: unknown,
  skipped?: boolean,
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const resultJson = payload === undefined ? null : JSON.stringify(payload);
  // duration_ms 为「该阶段累计耗时」：重试续跑时把本次耗时叠加到上次（失败）已花的时间上
  const row = db.prepare(`
    INSERT INTO analysis_stage_results (task_id, stage, stage_index, status, summary, result_json, duration_ms, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, stage) DO UPDATE SET
      status = excluded.status, summary = excluded.summary, result_json = excluded.result_json,
      duration_ms = COALESCE(analysis_stage_results.duration_ms, 0) + excluded.duration_ms,
      ended_at = excluded.ended_at
    RETURNING duration_ms
  `).get(taskId, stage, index, skipped ? "skipped" : "done", summary, resultJson, durationMs, now, now) as { duration_ms: number };
  return row.duration_ms;
}

export function recordStageFailed(
  taskId: number,
  stage: StageId,
  index: number,
  error: string,
  durationMs: number,
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare(`
    INSERT INTO analysis_stage_results (task_id, stage, stage_index, status, summary, duration_ms, started_at, ended_at)
    VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)
    ON CONFLICT(task_id, stage) DO UPDATE SET
      status = 'failed', summary = excluded.summary,
      duration_ms = COALESCE(analysis_stage_results.duration_ms, 0) + excluded.duration_ms,
      ended_at = excluded.ended_at
    RETURNING duration_ms
  `).get(taskId, stage, index, error, durationMs, now, now) as { duration_ms: number };
  return row.duration_ms;
}

export function getStages(taskId: number): StageRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM analysis_stage_results WHERE task_id = ? ORDER BY stage_index ASC")
    .all(taskId) as StageRow[];
}

/**
 * 从已持久化的阶段重建续跑上下文，并指出应从哪个阶段继续。
 * fromStage 为 null 表示所有阶段都已完成（无需续跑）。
 */
export function buildResumeContext(taskId: number): { ctx: WorkflowContext; fromStage: StageId | null } {
  const rows = getStages(taskId);
  const byStage = new Map(rows.map((r) => [r.stage, r] as const));
  const ctx: WorkflowContext = {};

  for (const stage of STAGE_ORDER) {
    const row = byStage.get(stage);
    if (row && (row.status === "done" || row.status === "skipped") && row.result_json) {
      applyStageResult(ctx, stage, JSON.parse(row.result_json));
    }
  }

  let fromStage: StageId | null = null;
  for (const stage of STAGE_ORDER) {
    const row = byStage.get(stage);
    if (!row || (row.status !== "done" && row.status !== "skipped")) {
      fromStage = stage;
      break;
    }
  }

  return { ctx, fromStage };
}

/** 成功后裁掉重型 result_json，仅保留 status/summary/duration 作为可量化阶段历史。 */
export function pruneStageResults(taskId: number): void {
  getDb().prepare("UPDATE analysis_stage_results SET result_json = NULL WHERE task_id = ?").run(taskId);
}

/** 清空某 task 的全部阶段记录（用于从头重跑）。 */
export function clearStageResults(taskId: number): void {
  getDb().prepare("DELETE FROM analysis_stage_results WHERE task_id = ?").run(taskId);
}
