import { useEffect, useState, type ReactElement } from "react";
import type { StageId } from "../../types.js";
import type { GenFlowState, StageState } from "../../hooks/useGenerationFlow.js";
import { Card } from "./Card.js";
import { Btn } from "./Btn.js";
import { Tag } from "./Tag.js";

interface StageMeta {
  id: StageId;
  name: string;
  desc: string;
  icon: IconName;
  parallel?: boolean;
  hints: string[];
}

const GEN_STAGES: StageMeta[] = [
  { id: "data_loaded", name: "加载数据源", desc: "行情 / 财报 / 公告 / 资金流", icon: "database", hints: ["连接 Tushare Pro …", "拉取行情 / 财报 / 资金流 / 龙虎榜", "汇总舆情与公告"] },
  { id: "knowledge_loaded", name: "知识库筛选", desc: "匹配相关研报 / 笔记 / 年报", icon: "layers", hints: ["检索知识库 …", "筛选与该标的相关的材料"] },
  { id: "analysis_complete", name: "基本面分析", desc: "财务质量 / 估值 / 成长性", icon: "chart", hints: ["计算 ROE / 负债率 / 现金流 …", "同业估值对比 (PE/PB)", "成长性与盈利能力评分"] },
  { id: "sentiment_complete", name: "情绪分析", desc: "新闻 / 舆情 / 资金情绪", icon: "pulse", hints: ["汇总新闻舆情 …", "情绪打分 + 主力资金验证", "识别预期差信号"] },
  { id: "report_complete", name: "研报生成", desc: "撰写各章节正文", icon: "doc", hints: ["生成公司概况 / 财务 / 估值章节 …", "归纳关键风险与机会", "给出估值区间与目标价"] },
  { id: "debate_complete", name: "多空辩论", desc: "并行：多头 vs 空头", icon: "scale", parallel: true, hints: ["并行展开多空论证 …"] },
  { id: "decision_complete", name: "投资决策", desc: "评级 / 目标价 / 仓位建议", icon: "target", hints: ["综合多空观点加权 …", "生成评级与目标价", "匹配风控给出建议"] },
];

function stageName(id: StageId): string {
  return GEN_STAGES.find((s) => s.id === id)?.name ?? id;
}

type IconName = "database" | "layers" | "chart" | "pulse" | "doc" | "scale" | "target";

function genIcon(name: IconName, size = 15) {
  const p: Record<IconName, ReactElement> = {
    database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
    pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    scale: <path d="M12 3v18M5 7l-3 6h6zM19 7l-3 6h6zM3 13a3 3 0 0 0 6 0M15 13a3 3 0 0 0 6 0M7 21h10" />,
    target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>;
}

function Spinner({ color = "var(--sim-accent)", size = 16 }: { color?: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid rgba(20,17,13,0.12)", borderTopColor: color,
      display: "inline-block", animation: "sim-spin 0.7s linear infinite",
    }} />
  );
}

interface StockLike { name?: string; ticker: string; exchange?: string }

/**
 * 生成用时 = 各阶段真实耗时（后端记录的 durationMs）之和 + 当前进行中阶段的本会话秒表。
 * 关键：不取「最早阶段开始 → now」的整体跨度——那会把用户离开页面的空档也算进去，离开越久越离谱。
 * 当前阶段的实时计时也只从本地观测到它运行的时刻起算，而非事件里的历史时间戳（SSE 重连会重放历史
 * stage_start），因此刷新 / 回看 / 重连都不会让用时暴涨，反映的是真正花在计算上的时间。
 */
function useElapsedMs(flow: GenFlowState): number {
  const runningStage =
    flow.phase === "running"
      ? (GEN_STAGES.find((s) => flow.stages[s.id]?.status === "running")?.id ?? null)
      : null;

  const [, tick] = useState(0);
  useEffect(() => {
    if (!runningStage) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [runningStage]);

  // base 含当前 running 阶段已累计的历史耗时（重试续跑时上次失败那段），本次由 live 叠加
  const base = GEN_STAGES.reduce((sum, s) => sum + (flow.stages[s.id]?.durationMs ?? 0), 0);
  // 当前阶段从它「真实开始时间」起算，切走切回保持连续；启动时 cleanupStaleTasks 会把中断的
  // 僵尸任务标记失败，因此真正 running 的阶段 startedAt 一定是近期值，不会把离开的空档算进来
  const startedAt = runningStage ? flow.stages[runningStage]?.startedAt : undefined;
  const live = startedAt != null ? Math.max(0, Date.now() - startedAt) : 0;
  return base + live;
}

// ── 概览页上的「生成进度」入口条：返回后仍可回看进度 / 失败原因 ──
export function GenProgressBanner({ flow, onOpen, onDismiss }: {
  flow: GenFlowState;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const elapsedMs = useElapsedMs(flow);

  const doneCount = GEN_STAGES.filter((s) => {
    const st = flow.stages[s.id]?.status;
    return st === "done" || st === "skipped";
  }).length;
  const meta = {
    running: { c: "var(--sim-accent)", bg: "var(--sim-accent-soft)", bd: "#F2CFA8", label: "生成中" },
    done: { c: "var(--sim-brand)", bg: "#EEF0FA", bd: "#D8DCEF", label: "已完成" },
    failed: { c: "var(--sim-up)", bg: "var(--sim-up-soft)", bd: "#F5C7CE", label: "生成失败" },
  }[flow.phase];
  const elapsedLabel = (elapsedMs / 1000).toFixed(1);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: "var(--sim-r-md)", background: meta.bg, border: `1px solid ${meta.bd}` }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: "rgba(255,255,255,0.6)", color: meta.c, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {flow.phase === "running" && <Spinner color={meta.c} size={14} />}
        {flow.phase === "done" && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>}
        {flow.phase === "failed" && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sim-text)" }}>研报生成进度</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: meta.c }}>{meta.label}{flow.phase === "running" && ` · ${doneCount}/${GEN_STAGES.length}`}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
          <StageDots flow={flow} />
          <span style={{ fontSize: 11, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)" }}>
            用时 {elapsedLabel}s
            {flow.phase === "failed" && flow.failedStage && ` · ${stageName(flow.failedStage)}阶段失败`}
          </span>
        </div>
      </div>
      <Btn kind={flow.phase === "failed" ? "primary" : "ghost"} size="sm" onClick={onOpen}>
        {flow.phase === "failed" ? "查看失败原因" : flow.phase === "running" ? "查看进度" : "查看详情"}
      </Btn>
      {flow.phase !== "running" && (
        <button onClick={onDismiss} title="清除记录" style={{
          width: 28, height: 28, borderRadius: 7, border: "1px solid var(--sim-border)",
          background: "rgba(255,255,255,0.5)", color: "var(--sim-text-mute)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </div>
  );
}

function StageDots({ flow }: { flow: GenFlowState }) {
  const colorOf = (status?: string): string =>
    status === "done" || status === "skipped" ? "var(--sim-brand)"
      : status === "running" ? "var(--sim-accent)"
      : status === "failed" ? "var(--sim-up)"
      : "var(--sim-border-strong)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {GEN_STAGES.map((st) => {
        const status = flow.stages[st.id]?.status ?? "pending";
        const c = colorOf(status);
        const running = status === "running";
        return (
          <span key={st.id} title={st.name} style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
            {running && <span style={{ position: "absolute", inset: -2, borderRadius: "50%", background: c, animation: "sim-pulse 1.4s ease-out infinite" }} />}
            <span style={{
              position: "relative", width: 8, height: 8, borderRadius: "50%",
              background: status === "pending" ? "transparent" : c,
              border: status === "pending" ? `1.5px solid ${c}` : "none",
              animation: running ? "sim-dot-pulse 1.1s ease-in-out infinite" : "none",
            }} />
          </span>
        );
      })}
    </div>
  );
}

function BackBtn({ onClick, label, hint }: { onClick: () => void; label: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={onClick} style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        border: "1px solid var(--sim-border)", background: "var(--sim-surface)",
        padding: "6px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer",
        color: "var(--sim-text-soft)", fontFamily: "var(--sim-sans)",
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        {label}
      </button>
      {hint && <span style={{ fontSize: 11, color: "var(--sim-text-faint)" }}>{hint}</span>}
    </div>
  );
}

// ── 生成视图（纯展示，由页面层的 flow 驱动；返回不丢进度）──
export function GenerationFlow({ stock, flow, onBack, onCancel, onRetry, onOpenReport, onOpenSettings }: {
  stock: StockLike;
  flow: GenFlowState;
  onBack: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onOpenReport: (reportId: number) => void;
  onOpenSettings?: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const elapsedMs = useElapsedMs(flow);

  const phase = flow.phase;
  const doneCount = GEN_STAGES.filter((s) => {
    const st = flow.stages[s.id]?.status;
    return st === "done" || st === "skipped";
  }).length;
  const progressPct = (doneCount / GEN_STAGES.length) * 100;
  const elapsedLabel = (elapsedMs / 1000).toFixed(1);

  const headTint = phase === "failed" ? "var(--sim-up-soft)" : phase === "done" ? "var(--sim-down-soft)" : "var(--sim-accent-soft)";
  const headBorder = phase === "failed" ? "#F5C7CE" : phase === "done" ? "#C7E3D4" : "#F2CFA8";
  const headColor = phase === "failed" ? "var(--sim-up)" : phase === "done" ? "var(--sim-down)" : "var(--sim-accent)";
  const barColor = phase === "failed" ? "var(--sim-up)" : phase === "done" ? "var(--sim-down)" : "var(--sim-accent)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card padded={false} style={{ padding: "16px 24px 18px" }}>
        <div style={{ marginBottom: 14 }}>
          <BackBtn onClick={onBack} label="返回报告概览"
            hint={phase === "running" ? "生成将在后台继续" : "进度已保留，可随时回看"} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 11, flexShrink: 0,
            background: headTint, border: `1px solid ${headBorder}`, color: headColor,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {phase === "running" && <Spinner />}
            {phase === "done" && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>}
            {phase === "failed" && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                {phase === "running" && `正在生成 ${stock.name || stock.ticker} 投研报告`}
                {phase === "done" && `${stock.name || stock.ticker} 投研报告生成完成`}
                {phase === "failed" && `${stock.name || stock.ticker} 报告生成中断`}
              </span>
              <span style={{ fontFamily: "var(--sim-mono)", fontSize: 12, color: "var(--sim-text-mute)" }}>{stock.exchange}.{stock.ticker}</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 3, fontFamily: "var(--sim-mono)" }}>
              {doneCount}/{GEN_STAGES.length} 阶段完成 · 用时 {elapsedLabel}s
            </div>
          </div>
          {phase === "running" && <Btn kind="ghost" size="sm" onClick={onCancel}>取消生成</Btn>}
          {phase === "done" && flow.reportId != null && <Btn kind="primary" size="sm" onClick={() => onOpenReport(flow.reportId!)}>查看完整报告 →</Btn>}
          {phase === "failed" && (
            <Btn kind="primary" size="sm" onClick={onRetry}
              icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>}>
              从失败阶段重试
            </Btn>
          )}
        </div>
        <div style={{ height: 4, background: "var(--sim-bg-soft)", borderRadius: 999, overflow: "hidden", marginTop: 14 }}>
          <div style={{ width: `${progressPct}%`, height: "100%", borderRadius: 999, background: barColor, transition: "width 0.34s ease" }} />
        </div>
      </Card>

      <Card title="生成流水线" subtitle="Agent 决策过程留痕 · 实时" action={
        <button onClick={() => setShowLogs((v) => !v)} style={{
          background: "none", border: "none", cursor: "pointer", fontSize: 12,
          color: "var(--sim-text-mute)", fontFamily: "var(--sim-sans)",
        }}>{showLogs ? "隐藏日志" : "查看完整日志"}</button>
      }>
        <div style={{ marginTop: 6 }}>
          {GEN_STAGES.map((stage, idx) => (
            <StageRow
              key={stage.id}
              stage={stage}
              idx={idx}
              state={flow.stages[stage.id]}
              last={idx === GEN_STAGES.length - 1}
              isFailed={flow.failedStage === stage.id}
              errorMessage={flow.errorMessage}
              onRetry={onRetry}
              onShowLogs={() => setShowLogs(true)}
              onOpenSettings={onOpenSettings}
            />
          ))}
        </div>
        {showLogs && <LogDrawer logs={flow.logs} />}
      </Card>

    </div>
  );
}

function StageRow({ stage, idx, state, last, isFailed, errorMessage, onRetry, onShowLogs, onOpenSettings }: {
  stage: StageMeta;
  idx: number;
  state: StageState | undefined;
  last: boolean;
  isFailed: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onShowLogs: () => void;
  onOpenSettings?: () => void;
}) {
  const status = state?.status ?? "pending";
  const nodeColor = status === "pending" ? "var(--sim-border-strong)"
    : status === "running" ? "var(--sim-accent)"
    : status === "failed" ? "var(--sim-up)"
    : "var(--sim-brand)";

  const titleColor = status === "pending" ? "var(--sim-text-mute)"
    : status === "failed" ? "var(--sim-up)"
    : status === "running" ? "var(--sim-accent)"
    : "var(--sim-text)";

  const realSubsteps = state?.substeps ?? [];
  const showHints = status === "running" && realSubsteps.length === 0;

  return (
    <div style={{ display: "flex", gap: 14, position: "relative" }}>
      <div style={{ position: "relative", width: 28, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {!last && (
          <div style={{
            position: "absolute", top: 28, bottom: 0, width: 2,
            background: status === "done" || status === "skipped" ? "var(--sim-brand)" : "var(--sim-hairline)",
          }} />
        )}
        <div style={{
          width: 28, height: 28, borderRadius: "50%", zIndex: 1,
          background: status === "pending" ? "var(--sim-surface)"
            : status === "running" ? "var(--sim-accent-soft)"
            : status === "failed" ? "var(--sim-up-soft)"
            : "var(--sim-brand)",
          border: `2px solid ${nodeColor}`,
          color: status === "done" || status === "skipped" ? "#fff" : nodeColor,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {status === "running" && <Spinner size={12} />}
          {(status === "done" || status === "skipped") && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
          {status === "failed" && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
          {status === "pending" && <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, fontWeight: 600, color: "var(--sim-text-faint)" }}>{idx + 1}</span>}
        </div>
      </div>

      <div style={{ flex: 1, paddingBottom: last ? 4 : 22, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 28 }}>
          <span style={{ color: titleColor }}>{genIcon(stage.icon, 15)}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: titleColor }}>{stage.name}</span>
          {stage.parallel && <Tag kind="accent" size="sm">并行</Tag>}
          <span style={{ fontSize: 11.5, color: "var(--sim-text-mute)" }}>{stage.desc}</span>
          <div style={{ flex: 1 }} />
          {status === "running" && <Tag kind="accent" size="sm">进行中</Tag>}
          {status === "skipped" && <Tag kind="ghost" size="sm">已跳过</Tag>}
          {status === "done" && state?.durationMs != null && (
            <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)" }}>{state.durationMs < 100 ? "<0.1s" : `${(state.durationMs / 1000).toFixed(1)}s`}</span>
          )}
          {status === "failed" && <Tag kind="up" size="sm">失败</Tag>}
        </div>

        {stage.parallel ? (
          (status === "running" || status === "done") && <DebateLanes substeps={realSubsteps} />
        ) : (
          <>
            {showHints && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {stage.hints.map((h, i) => <SubstepLine key={i} text={h} muted />)}
              </div>
            )}
            {realSubsteps.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {realSubsteps.map((s, i) => <SubstepLine key={i} text={s.text} />)}
              </div>
            )}
            {(status === "done" || status === "skipped") && state?.summary && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--sim-text-soft)", lineHeight: 1.5 }}>{state.summary}</div>
            )}
          </>
        )}

        {isFailed && (
          <FailureAttribution stage={stage} errorMessage={errorMessage} onRetry={onRetry} onShowLogs={onShowLogs} onOpenSettings={onOpenSettings} />
        )}
      </div>
    </div>
  );
}

function SubstepLine({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: muted ? "var(--sim-text-faint)" : "var(--sim-text-soft)" }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--sim-text-faint)", flexShrink: 0 }} />
      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11.5 }}>{text}</span>
    </div>
  );
}

function DebateLanes({ substeps }: { substeps: { text: string; side?: "bull" | "bear" }[] }) {
  const bull = substeps.filter((s) => s.side === "bull");
  const bear = substeps.filter((s) => s.side === "bear");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
      <div style={{ padding: "10px 12px", background: "var(--sim-up-soft)", border: "1px solid #F5C7CE", borderRadius: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-up)" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sim-up)" }}>多头 BULL</span>
        </div>
        {bull.length === 0 ? <div style={{ fontSize: 11.5, color: "var(--sim-text-faint)" }}>辩论进行中…</div>
          : bull.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: "var(--sim-text-soft)", lineHeight: 1.6 }}>{s.text}</div>)}
      </div>
      <div style={{ padding: "10px 12px", background: "var(--sim-down-soft)", border: "1px solid #C7E3D4", borderRadius: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-down)" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sim-down)" }}>空头 BEAR</span>
        </div>
        {bear.length === 0 ? <div style={{ fontSize: 11.5, color: "var(--sim-text-faint)" }}>辩论进行中…</div>
          : bear.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: "var(--sim-text-soft)", lineHeight: 1.6 }}>{s.text}</div>)}
      </div>
    </div>
  );
}

function FailureAttribution({ stage, errorMessage, onRetry, onShowLogs, onOpenSettings }: {
  stage: StageMeta;
  errorMessage: string | null;
  onRetry: () => void;
  onShowLogs: () => void;
  onOpenSettings?: () => void;
}) {
  const failedIdx = GEN_STAGES.findIndex((s) => s.id === stage.id);
  const downstream = GEN_STAGES.slice(failedIdx + 1).map((s) => s.name);
  const impact = downstream.length > 0
    ? `${stage.name}失败，其下游（${downstream.join(" / ")}）未执行`
    : `${stage.name}失败`;
  const reuse = failedIdx > 0
    ? `阶段 1–${failedIdx} 结果已缓存，重试将从「${stage.name}」继续，无需重跑`
    : `重试将从「${stage.name}」重新开始`;

  return (
    <div style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", border: "1px solid #F5C7CE" }}>
      <div style={{ padding: "10px 14px", background: "var(--sim-up-soft)", display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sim-up)" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--sim-up)" }}>失败归因分析</span>
        <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-up)", opacity: 0.8 }}>stage: {stage.id}</span>
      </div>
      <div style={{ padding: "14px 16px", background: "var(--sim-surface)" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <AttrRow label="错误信息" value={errorMessage ?? "未知错误"} mono cls="up" />
          <AttrRow label="影响范围" value={impact} />
          <AttrRow label="可复用" value={reuse} cls="down" last />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Btn kind="primary" size="sm" onClick={onRetry}
            icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>}>
            从该阶段重试
          </Btn>
          {onOpenSettings && <Btn kind="ghost" size="sm" onClick={onOpenSettings}>检查数据源配置</Btn>}
          <Btn kind="ghost" size="sm" onClick={onShowLogs}>查看完整日志</Btn>
        </div>
      </div>
    </div>
  );
}

function AttrRow({ label, value, mono, cls, last }: { label: string; value: string; mono?: boolean; cls?: "up" | "down"; last?: boolean }) {
  const color = cls === "up" ? "var(--sim-up)" : cls === "down" ? "var(--sim-down)" : "var(--sim-text)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 12, padding: "8px 0", borderBottom: last ? "none" : "1px solid var(--sim-hairline)" }}>
      <span style={{ fontSize: 11.5, color: "var(--sim-text-mute)" }}>{label}</span>
      <span style={{ fontSize: 12.5, color, fontFamily: mono ? "var(--sim-mono)" : "var(--sim-sans)", lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function LogDrawer({ logs }: { logs: GenFlowState["logs"] }) {
  return (
    <div style={{ marginTop: 12, maxHeight: 220, overflow: "auto", background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)", padding: "10px 14px", fontFamily: "var(--sim-mono)", fontSize: 11.5, lineHeight: 1.6 }}>
      {logs.length === 0 ? <div style={{ color: "var(--sim-text-faint)" }}>暂无日志</div>
        : logs.map((l, i) => <div key={i} style={{ color: "var(--sim-text-soft)", whiteSpace: "pre-wrap" }}>{l.message}</div>)}
    </div>
  );
}

