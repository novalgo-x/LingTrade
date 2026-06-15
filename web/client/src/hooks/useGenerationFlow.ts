import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import type { StageEvent, StageId, StageRow } from "../types.js";

export type StagePhase = "pending" | "running" | "done" | "failed" | "skipped";

export interface Substep {
  text: string;
  side?: "bull" | "bear";
}

export interface StageState {
  status: StagePhase;
  summary?: string;
  durationMs?: number;
  /** 该阶段真实开始时间（epoch ms），用于给「进行中」阶段做连续计时（切走切回不重置）。 */
  startedAt?: number;
  substeps: Substep[];
}

export interface LogLine {
  timestamp: string;
  message: string;
}

export interface GenFlowState {
  phase: "running" | "done" | "failed";
  stages: Partial<Record<StageId, StageState>>;
  reportId: number | null;
  errorMessage: string | null;
  failedStage: StageId | null;
  /** 最早阶段开始 / 最晚阶段结束的真实时间戳（epoch ms），用于跨重挂仍准确的计时。 */
  startedAt: number | null;
  endedAt: number | null;
  /** 是否已从持久化阶段或 SSE 事件加载到真实状态；为 false 时 phase 只是初始默认值，不可据此判定"运行中"。 */
  loaded: boolean;
  logs: LogLine[];
}

const EMPTY: GenFlowState = {
  phase: "running",
  stages: {},
  reportId: null,
  errorMessage: null,
  failedStage: null,
  startedAt: null,
  endedAt: null,
  loaded: false,
  logs: [],
};

function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function reduceStage(prev: GenFlowState, ev: StageEvent): GenFlowState {
  const stages = { ...prev.stages };
  const cur: StageState = stages[ev.stage] ?? { status: "pending", substeps: [] };

  if (ev.kind === "stage_start") {
    // 阶段已到达终态（done/failed/skipped）则此 stage_start 为 SSE 重播历史，跳过以防回退
    if (cur.status === "done" || cur.status === "failed" || cur.status === "skipped") {
      return prev;
    }
    // 重放/重连可能重复推同一 stage_start：阶段已在运行就保留原 startedAt，不重置秒表
    const startedAt = cur.status === "running" && cur.startedAt != null ? cur.startedAt : (parseTs(ev.at) ?? Date.now());
    stages[ev.stage] = {
      status: "running",
      startedAt,
      substeps: cur.status === "running" ? cur.substeps : [],
      ...(cur.durationMs != null ? { durationMs: cur.durationMs } : {}),
    };
    return { ...prev, stages, loaded: true, phase: "running", failedStage: null, errorMessage: null, startedAt: prev.startedAt ?? startedAt };
  }
  if (ev.kind === "substep") {
    const sub: Substep = ev.side ? { text: ev.text, side: ev.side } : { text: ev.text };
    stages[ev.stage] = {
      ...cur,
      status: cur.status === "pending" ? "running" : cur.status,
      substeps: [...cur.substeps, sub],
    };
    return { ...prev, stages, loaded: true };
  }
  if (ev.kind === "stage_done") {
    stages[ev.stage] = {
      status: ev.skipped ? "skipped" : "done",
      summary: ev.summary,
      durationMs: ev.durationMs,
      substeps: cur.substeps,
    };
    return { ...prev, stages, loaded: true, endedAt: parseTs(ev.at) ?? prev.endedAt };
  }
  // stage_failed
  stages[ev.stage] = { status: "failed", summary: ev.error, durationMs: ev.durationMs, substeps: cur.substeps };
  return { ...prev, stages, loaded: true, phase: "failed", failedStage: ev.stage, errorMessage: ev.error, endedAt: parseTs(ev.at) ?? prev.endedAt };
}

function seedFromRows(prev: GenFlowState, rows: StageRow[]): GenFlowState {
  const stages: GenFlowState["stages"] = {};
  let failedStage: StageId | null = null;
  let errorMessage: string | null = prev.errorMessage;
  let startedAt: number | null = prev.startedAt;
  let endedAt: number | null = prev.endedAt;
  for (const r of rows) {
    const status: StagePhase =
      r.status === "skipped" ? "skipped" : r.status === "failed" ? "failed" : r.status === "done" ? "done" : "running";
    const st = parseTs(r.started_at);
    stages[r.stage] = {
      status,
      substeps: [],
      ...(r.summary ? { summary: r.summary } : {}),
      ...(r.duration_ms != null ? { durationMs: r.duration_ms } : {}),
      ...(st != null ? { startedAt: st } : {}),
    };
    if (st != null) startedAt = startedAt == null ? st : Math.min(startedAt, st);
    const en = parseTs(r.ended_at);
    if (en != null) endedAt = endedAt == null ? en : Math.max(endedAt, en);
    if (status === "failed") {
      failedStage = r.stage;
      errorMessage = r.summary ?? errorMessage;
    }
  }
  // 从阶段推断整体进度：有失败→failed；末阶段(决策)完成→done；否则仍在运行
  const phase: GenFlowState["phase"] = failedStage
    ? "failed"
    : stages["decision_complete"]?.status === "done"
      ? "done"
      : "running";
  return { ...prev, stages, failedStage, errorMessage, startedAt, endedAt, loaded: true, phase };
}

/**
 * 订阅某个分析任务的结构化阶段事件，重建生成流水线状态。
 * 挂载时先用持久化阶段播种（刷新/重连可立即还原时间线），再消费实时 SSE。
 */
export function useGenerationFlow(taskId: number | null, epoch = 0): GenFlowState {
  const [state, setState] = useState<GenFlowState>(EMPTY);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (taskId === null) {
      setState(EMPTY);
      return;
    }
    setState(EMPTY);
    let cancelled = false;

    api
      .getTaskStages(taskId)
      .then((rows) => {
        if (!cancelled && rows.length > 0) setState((prev) => seedFromRows(prev, rows));
      })
      .catch(() => {});

    const es = new EventSource(`/api/tasks/${taskId}/logs`);
    esRef.current = es;

    es.addEventListener("stage", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as StageEvent;
      setState((prev) => reduceStage(prev, ev));
    });

    es.addEventListener("log", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as LogLine;
      setState((prev) => ({ ...prev, logs: [...prev.logs, d] }));
    });

    es.addEventListener("status", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { status: string; reportId: number | null };
      setState((prev) => ({ ...prev, loaded: true, phase: "done", reportId: d.reportId }));
      es.close();
    });

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        const d = JSON.parse(e.data) as { message: string };
        setState((prev) => ({ ...prev, loaded: true, phase: "failed", errorMessage: prev.errorMessage ?? d.message }));
        es.close();
      }
      // 非 MessageEvent 为连接级错误，交由 EventSource 自动重连（重连时会重放阶段）
    });

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, [taskId, epoch]);

  return state;
}
