import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "../../api.js";
import { simApi } from "../api.js";
import { GenerationFlow, GenProgressBanner } from "../components/GenerationFlow.js";
import { useGenerationFlow, type GenFlowState } from "../../hooks/useGenerationFlow.js";
import type { Stock, ReportSummary, ReportFull, RecommendationAction } from "../../types.js";
import { Card } from "../components/Card.js";
import { Tag, ActionTag } from "../components/Tag.js";
import { Btn } from "../components/Btn.js";
import { Tabs } from "../components/Tabs.js";
import { PulseDot } from "../components/PulseDot.js";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "-";
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

function isStale(dateStr: string): boolean {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return false;
  return Date.now() - then > 3 * 24 * 60 * 60 * 1000;
}

function fmtNum(val: unknown, digits: number): string {
  return typeof val === "number" && isFinite(val) ? val.toFixed(digits) : "-";
}

function fmtPct(val: unknown): string {
  return typeof val === "number" ? `${(val * 100).toFixed(0)}%` : "-";
}

function toText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["detail", "event", "risk", "scenario", "opinion", "summary", "thesis", "rationale", "text", "message", "description", "content"]) {
      if (typeof obj[key] === "string") {
        const tag = obj.type ?? obj.severity ?? obj.label;
        return tag ? `[${tag}] ${obj[key]}` : (obj[key] as string);
      }
    }
    const parts = Object.entries(obj).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => `${k}: ${v}`);
    return parts.join(" | ") || JSON.stringify(value);
  }
  return String(value);
}

function normalizeAction(val: unknown): RecommendationAction {
  if (typeof val === "string") {
    const lower = val.toLowerCase();
    if (lower === "buy") return "buy";
    if (lower === "sell") return "sell";
  }
  return "hold";
}

function verdictGradient(action: RecommendationAction): string {
  if (action === "buy") return "linear-gradient(135deg, #D7263D 0%, #B91C2C 100%)";
  if (action === "sell") return "linear-gradient(135deg, #1F8A5B 0%, #166543 100%)";
  return "linear-gradient(135deg, #5A554D 0%, #3F3A33 100%)";
}

type GenOutcome = { kind: "done" | "failed"; key: string };

// 列表「未读小点」的判定依据：某股最近一次生成的结果。失败任务优先（红点）；
// 否则有成功报告即取报告时间戳（绿点）。key 同时用于「是否已读」比对。
function outcomeOf(
  stockId: number,
  reports: Map<number, ReportSummary>,
  tasks: Map<number, { status: string; taskId: number; completedAt: string | null }>,
): GenOutcome | null {
  const task = tasks.get(stockId);
  // 失败 key 取「本次运行结束时刻」：重试复用同一 taskId，但每次失败 completedAt 都会刷新，
  // 这样重试后再次失败也能产生新的未读小点（仅用 taskId 则 key 不变，重试失败不会提示）。
  if (task?.status === "failed") return { kind: "failed", key: `f${task.completedAt ?? task.taskId}` };
  const rep = reports.get(stockId);
  if (rep) return { kind: "done", key: rep.created_at };
  return null;
}

export function ResearchPage({ initialReportId }: { initialReportId?: number } = {}) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [latestReports, setLatestReports] = useState<Map<number, ReportSummary>>(new Map());
  // 每股最近一次任务状态（含失败），与 latestReports 一起决定列表未读小点的颜色/有无
  const [latestTasks, setLatestTasks] = useState<Map<number, { status: string; taskId: number; completedAt: string | null }>>(new Map());
  const [viewReport, setViewReport] = useState<ReportFull | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: "stock" | "report"; id: number; name: string } | null>(null);
  const [taskMap, setTaskMap] = useState<Map<number, number>>(new Map());
  const taskId = selectedStockId ? (taskMap.get(selectedStockId) ?? null) : null;
  const [genOpen, setGenOpen] = useState(false);
  const [genEpoch, setGenEpoch] = useState(0);
  const dismissedRef = useRef<Set<number>>(new Set());
  const flow = useGenerationFlow(taskId, genEpoch);
  // 全列表「生成中」的真实来源：轮询所有运行中的任务（含批量当前那只、后台未选中的股）
  const [runningStocks, setRunningStocks] = useState<Set<number>>(new Set());
  const runningStocksRef = useRef<Set<number>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [batch, setBatch] = useState<{
    running: boolean; total: number; completed: number; failed: number;
    current: { ticker: string; name: string; attempt: number } | null;
    results: Array<{ ticker: string; name: string; status: string; error?: string; attempts: number }>;
  } | null>(null);

  const [tushareOk, setTushareOk] = useState<boolean | null>(null);
  const [llmOk, setLlmOk] = useState<boolean | null>(null);
  const [showTushareHint, setShowTushareHint] = useState(false);
  const [showLlmHint, setShowLlmHint] = useState(false);

  const didInitialJump = useRef(false);
  const needsScroll = useRef(!!initialReportId);
  // 列表「未读」标记：记录每只股已读的「最近一次生成结果」标识（成功报告时间戳 / 失败任务号）；
  // 结果比这更新即视为未读，生成完（成功或失败）都会出现小点，点击该股即清除。
  const seenOutcomeRef = useRef<Map<number, string>>(new Map());
  const seenInitRef = useRef(false);
  // 始终持有最新 latestReports，供下面「标记已读」effect 读取而无需把它放进依赖
  const latestReportsRef = useRef(latestReports);
  latestReportsRef.current = latestReports;
  const latestTasksRef = useRef(latestTasks);
  latestTasksRef.current = latestTasks;

  const selectedStock = stocks.find(s => s.id === selectedStockId) ?? null;

  const loadStocks = useCallback(async () => {
    const [list, latests, tasks] = await Promise.all([
      api.listStocks(),
      api.getLatestReports(),
      api.getLatestTasks(),
    ]);
    setStocks(list);
    // 仅在尚未选中任何标的时默认选第一只；用函数式更新避免闭包里捕获到过期的 selectedStockId
    if (list.length > 0 && !initialReportId) setSelectedStockId((prev) => prev ?? list[0]!.id);
    const reportMap = new Map<number, ReportSummary>();
    for (const rep of latests) {
      reportMap.set(rep.stock_id, rep);
    }
    setLatestReports(reportMap);
    const latestTaskMap = new Map<number, { status: string; taskId: number; completedAt: string | null }>();
    for (const t of tasks) {
      latestTaskMap.set(t.stockId, { status: t.status, taskId: t.taskId, completedAt: t.completedAt });
    }
    setLatestTasks(latestTaskMap);
    // 首次加载时把现有结果（成功报告 / 失败任务）全部标为已读，避免历史结果被误判为未读
    if (!seenInitRef.current) {
      seenInitRef.current = true;
      for (const s of list) {
        const oc = outcomeOf(s.id, reportMap, latestTaskMap);
        if (oc) seenOutcomeRef.current.set(s.id, oc.key);
      }
    }
    return list;
  }, []);

  useEffect(() => {
    loadStocks();
    simApi.getTushare().then(t => setTushareOk(!!t.token || !!t.rawToken)).catch(() => setTushareOk(false));
    simApi.getLlmStatus().then(s => setLlmOk(s.configured)).catch(() => setLlmOk(false));
  }, []);

  // 轮询运行中的任务：哪些股在生成 = 列表转圈的唯一来源；某股离开运行集（生成完）即刷新报告以出现未读小点
  const refreshActiveTasks = useCallback(async () => {
    try {
      const tasks = await api.getActiveTasks();
      const next = new Set(tasks.map(t => t.stockId));
      const prev = runningStocksRef.current;
      let someFinished = false;
      for (const id of prev) if (!next.has(id)) { someFinished = true; break; }
      runningStocksRef.current = next;
      setRunningStocks(next);
      if (someFinished) loadStocks();
    } catch { /* 忽略 */ }
  }, [loadStocks]);

  // 进入研报页即常态轮询活跃任务（开销极小），保证后台/未选中股的"生成中"也能持续转圈
  useEffect(() => {
    refreshActiveTasks();
    const id = setInterval(refreshActiveTasks, 3000);
    return () => clearInterval(id);
  }, [refreshActiveTasks]);

  const handleAddClick = () => {
    if (tushareOk === false) {
      setShowTushareHint(true);
    } else {
      setShowAdd(true);
    }
  };

  useEffect(() => {
    if (!initialReportId || didInitialJump.current || stocks.length === 0) return;
    didInitialJump.current = true;
    api.getReport(initialReportId).then(full => {
      if (full.stock_id) {
        setSelectedStockId(full.stock_id);
        api.listReports(full.stock_id).then(setReports).catch(() => {});
      }
      setViewReport(full);
    }).catch(() => {});
  }, [initialReportId, stocks]);

  useEffect(() => {
    if (!selectedStockId) { setReports([]); return; }
    const stockId = selectedStockId;
    api.listReports(stockId).then(setReports).catch(() => setReports([]));
    // 恢复最近一次「运行中 / 失败」的生成进度（未被清除、且尚未在跟踪），用于刷新后回看失败原因
    api.getLatestTask(stockId).then(r => {
      if (!r.taskId || (r.status !== "running" && r.status !== "failed")) return;
      if (dismissedRef.current.has(r.taskId)) return;
      setTaskMap(prev => prev.has(stockId) ? prev : new Map(prev).set(stockId, r.taskId!));
    }).catch(() => {});
  }, [selectedStockId]);

  // 切换到某只股时，把它当前的最新报告标记为已读；故意只依赖 selectedStockId：
  // 不能依赖 latestReports，否则"生成完成产生新报告"会把当前选中股也立刻标已读，未读小点就永远不出现。
  // 新报告的已读由「点击列表项」时记录（见列表项 onClick）。
  useEffect(() => {
    if (!selectedStockId) return;
    const oc = outcomeOf(selectedStockId, latestReportsRef.current, latestTasksRef.current);
    if (oc) seenOutcomeRef.current.set(selectedStockId, oc.key);
  }, [selectedStockId]);

  const handleAnalyze = async () => {
    if (!selectedStockId) return;
    if (llmOk === false) { setShowLlmHint(true); return; }
    const stockId = selectedStockId;
    try {
      const { taskId: newTaskId } = await api.startAnalysis(stockId);
      setTaskMap(prev => new Map(prev).set(stockId, newTaskId));
      setGenOpen(true);
      const nextRunning = new Set(runningStocksRef.current).add(stockId);
      runningStocksRef.current = nextRunning;
      setRunningStocks(nextRunning);
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : "启动分析失败");
    }
  };

  // 生成完成：刷新侧栏与历史列表（保留进度入口，由用户在结果卡点击查看完整报告）
  const completedReportRef = useRef<number | null>(null);
  useEffect(() => {
    if (flow.phase === "done" && flow.reportId != null && completedReportRef.current !== flow.reportId) {
      completedReportRef.current = flow.reportId;
      const stockId = selectedStockId;
      if (stockId) api.listReports(stockId).then(setReports).catch(() => {});
      loadStocks();
    }
  }, [flow.phase, flow.reportId, selectedStockId, loadStocks]);

  const handleRetryGen = async () => {
    if (taskId == null) return;
    try { await api.retryTask(taskId); setGenEpoch(e => e + 1); }
    catch (err) { setToastMsg(err instanceof Error ? err.message : "重试失败"); }
  };

  // 取消：中断并放弃这次运行，清除进度入口并返回概览
  const handleCancelGen = async () => {
    if (taskId == null) return;
    try { await api.cancelTask(taskId); } catch { /* 忽略 */ }
    dismissedRef.current.add(taskId);
    const stockId = selectedStockId;
    setTaskMap(prev => { const next = new Map(prev); if (stockId) next.delete(stockId); return next; });
    setGenOpen(false);
  };

  // 清除进度记录：仅移除概览页的进度入口条，已生成的报告保留
  const handleDismissGen = () => {
    if (taskId != null) dismissedRef.current.add(taskId);
    const stockId = selectedStockId;
    setTaskMap(prev => { const next = new Map(prev); if (stockId) next.delete(stockId); return next; });
    setGenOpen(false);
  };

  const openReport = async (reportId: number) => {
    try {
      const full = await api.getReport(reportId);
      setViewReport(full);
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : "加载报告失败");
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.type === "stock") {
        await api.deleteStock(pendingDelete.id);
        if (selectedStockId === pendingDelete.id) {
          setSelectedStockId(null);
          setViewReport(null);
        }
        loadStocks();
      } else {
        await api.deleteReport(pendingDelete.id);
        if (viewReport?.id === pendingDelete.id) setViewReport(null);
        if (selectedStockId) api.listReports(selectedStockId).then(setReports);
        loadStocks();
      }
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : "删除失败");
    }
    setPendingDelete(null);
  };

  useEffect(() => {
    api.getBatchStatus().then(s => { if (s.running || s.completed > 0 || s.failed > 0) setBatch(s); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!batch?.running) return;
    const id = setInterval(() => {
      api.getBatchStatus().then(s => {
        setBatch(s);
        if (!s.running) { clearInterval(id); loadStocks(); }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [batch?.running, loadStocks]);

  const handleBatchAnalyze = async () => {
    if (llmOk === false) { setShowLlmHint(true); return; }
    try {
      await api.startBatchAnalysis();
      const s = await api.getBatchStatus();
      setBatch(s);
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : "启动批量分析失败");
    }
  };

  const handleCancelBatch = async () => {
    try {
      await api.cancelBatchAnalysis();
      const s = await api.getBatchStatus();
      setBatch(s);
      setToastMsg("已取消批量分析");
    } catch {}
  };

  // 「分析中」按钮态：以轮询得到的运行集为真实来源；flow 仅在已加载到真实状态后参与判断，
  // 避免切到「失败/历史」标的时 flow 短暂停留在初始 phase="running" 而把生成按钮误显示成「分析中…」
  const isAnalyzing =
    selectedStockId !== null &&
    (runningStocks.has(selectedStockId) || (flow.loaded && flow.phase === "running"));

  const coverageCount = useMemo(() => {
    let covered = 0;
    let staleCount = 0;
    let buyCount = 0;
    let sellCount = 0;
    for (const s of stocks) {
      const rep = latestReports.get(s.id);
      if (rep) {
        covered++;
        if (isStale(rep.created_at)) staleCount++;
        const act = normalizeAction(rep.action);
        if (act === "buy") buyCount++;
        if (act === "sell") sellCount++;
      }
    }
    return { total: stocks.length, covered, staleCount, buyCount, sellCount };
  }, [stocks, latestReports]);

  const filteredStocks = useMemo(() => {
    return stocks.filter(s => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.name?.toLowerCase().includes(q) && !s.ticker?.toLowerCase().includes(q)) return false;
      }
      const rep = latestReports.get(s.id);
      if (filter === "buy") return rep && normalizeAction(rep.action) === "buy";
      if (filter === "sell") return rep && normalizeAction(rep.action) === "sell";
      if (filter === "stale") return rep && isStale(rep.created_at);
      if (filter === "empty") return !rep;
      return true;
    });
  }, [stocks, latestReports, search, filter]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, minHeight: "calc(100vh - 120px)" }}>
      <Card padded={false} style={{ position: "sticky", top: 80, height: "fit-content", maxHeight: "calc(100vh - 96px)", display: "flex", flexDirection: "column", alignSelf: "start" }}>
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--sim-hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>研报覆盖</div>
            <Btn size="sm" kind={batch?.running ? "danger" : "primary"}
              onClick={batch?.running ? handleCancelBatch : handleBatchAnalyze}
              disabled={stocks.length === 0}>
              {batch?.running ? "取消批量" : "批量生成"}
            </Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
            <SidebarStat label="覆盖" value={`${coverageCount.covered}/${coverageCount.total}`} />
            <SidebarStat label="过期" value={coverageCount.staleCount} color="#9A6700" />
            <SidebarStat label="买入" value={coverageCount.buyCount} color="var(--sim-up)" />
            <SidebarStat label="卖出" value={coverageCount.sellCount} color="var(--sim-down)" />
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px", background: "var(--sim-bg-soft)", borderRadius: 6,
            border: "1px solid var(--sim-border)", marginBottom: 8,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sim-text-mute)" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索代码 / 名称" style={{
              border: "none", background: "transparent", outline: "none", flex: 1,
              fontSize: 12, color: "var(--sim-text)", fontFamily: "var(--sim-sans)",
            }}/>
          </div>
          <Tabs value={filter} onChange={setFilter} size="sm"
            tabs={[
              { value: "all", label: "全部" },
              { value: "sell", label: "卖出" },
              { value: "buy", label: "买入" },
              { value: "stale", label: "过期" },
              { value: "empty", label: "空" },
            ]}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {filteredStocks.map(s => {
            const rep = latestReports.get(s.id);
            const active = s.id === selectedStockId;
            const act = rep ? normalizeAction(rep.action) : null;
            const stale = rep ? isStale(rep.created_at) : false;
            const hasReport = !!rep;
            const running = runningStocks.has(s.id) || (active && flow.loaded && flow.phase === "running");
            const outcome = outcomeOf(s.id, latestReports, latestTasks);
            const unread = !!outcome && !active && !running && outcome.key !== (seenOutcomeRef.current.get(s.id) ?? "");
            return (
              <div key={s.id}
                ref={active && needsScroll.current ? el => { if (el) { el.scrollIntoView({ block: "start" }); needsScroll.current = false; } } : undefined}
                onClick={() => {
                  setSelectedStockId(s.id); setViewReport(null); setGenOpen(false);
                  if (outcome) seenOutcomeRef.current.set(s.id, outcome.key);
                }}
                style={{
                  padding: "12px 16px", cursor: "pointer",
                  borderBottom: "1px solid var(--sim-hairline)",
                  borderLeft: active ? "3px solid var(--sim-brand)" : "3px solid transparent",
                  background: active ? "var(--sim-bg-soft)" : "transparent",
                }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{s.name || s.ticker}</span>
                      {running ? (
                        <span style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(20,17,13,0.12)", borderTopColor: "var(--sim-accent)", display: "inline-block", animation: "sim-spin 0.7s linear infinite", flexShrink: 0 }} />
                      ) : unread ? (
                        <span title={outcome!.kind === "failed" ? "生成失败未读" : "新报告未读"} style={{ width: 7, height: 7, borderRadius: "50%", background: outcome!.kind === "failed" ? "var(--sim-up)" : "var(--sim-down)", flexShrink: 0 }} />
                      ) : null}
                      {hasReport && act ? (
                        <ActionTag action={act} size="sm" />
                      ) : (
                        <Tag kind="ghost" size="sm">未生成</Tag>
                      )}
                    </div>
                    <div style={{ fontSize: 11 }}>
                      <span style={{ fontFamily: "var(--sim-mono)", color: "var(--sim-text-mute)" }}>
                        {s.ticker}.{s.exchange}{rep ? ` · v${rep.report_count}` : ""}
                      </span>
                    </div>
                    {hasReport && rep && (
                      <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                        <span>目标 ¥{typeof rep.target_price === "number" ? rep.target_price.toFixed(2) : "-"}</span>
                      </div>
                    )}
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11, color: stale ? "#9A6700" : !hasReport ? "var(--sim-text-faint)" : "var(--sim-text-mute)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {rep ? relativeTime(rep.created_at) : "-"}
                  </span>
                </div>
              </div>
            );
          })}
          {filteredStocks.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>
              {stocks.length === 0 ? "暂无自选股" : "无匹配结果"}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--sim-hairline)" }}>
          <button onClick={handleAddClick} style={{
            width: "100%", padding: "8px 0", border: "1px dashed var(--sim-border-strong)", borderRadius: 8,
            background: "transparent", color: "var(--sim-text-soft)", fontSize: 13, cursor: "pointer",
            fontFamily: "var(--sim-sans)",
          }}>+ 添加股票</button>
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {batch && (batch.running || batch.completed > 0 || batch.failed > 0) && (
          <BatchPanel batch={batch} onDismiss={() => setBatch(null)} />
        )}

        {viewReport ? (
          <ReportDetailView
            report={viewReport}
            ticker={selectedStock?.ticker ?? ""}
            onBack={() => setViewReport(null)}
            onDelete={id => setPendingDelete({ type: "report", id, name: `报告 #${id}` })}
          />
        ) : selectedStock && genOpen && taskId !== null ? (
          <GenerationFlow
            stock={selectedStock}
            flow={flow}
            onBack={() => setGenOpen(false)}
            onCancel={handleCancelGen}
            onRetry={handleRetryGen}
            onOpenReport={(rid) => { setGenOpen(false); openReport(rid); }}
          />
        ) : selectedStock ? (
          <StockOverviewPanel
            stock={selectedStock}
            reports={reports}
            latestReport={latestReports.get(selectedStock.id) ?? null}
            genFlow={taskId !== null && flow.loaded ? flow : null}
            onAnalyze={handleAnalyze}
            isAnalyzing={isAnalyzing}
            onOpenGen={() => setGenOpen(true)}
            onDismissGen={handleDismissGen}
            onOpenReport={openReport}
            onDeleteStock={() => setPendingDelete({ type: "stock", id: selectedStock.id, name: selectedStock.name || selectedStock.ticker })}
          />
        ) : (
          <Card><div style={{ padding: 60, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 14 }}>选择一只股票查看研报</div></Card>
        )}
      </div>

      {showTushareHint && (
        <TushareHintDialog
          onContinue={() => { setShowTushareHint(false); setShowAdd(true); }}
          onCancel={() => setShowTushareHint(false)}
        />
      )}

      {showLlmHint && (
        <LlmHintDialog onClose={() => setShowLlmHint(false)} />
      )}

      {showAdd && <AddStockDialog onClose={() => setShowAdd(false)} onCreated={stock => {
        setShowAdd(false);
        loadStocks();
        setSelectedStockId(stock.id);
      }} />}

      {pendingDelete && <ConfirmDialog message={`确定要删除「${pendingDelete.name}」吗？`}
        onConfirm={handleConfirmDelete} onCancel={() => setPendingDelete(null)} />}

      {toastMsg && <SimToast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </div>
  );
}

function SidebarStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ padding: "6px 8px", background: "var(--sim-bg-soft)", borderRadius: 6, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, fontFamily: "var(--sim-mono)", color: color ?? "var(--sim-text)" }}>
        {value}
      </div>
    </div>
  );
}

function StockOverviewPanel({ stock, reports, latestReport, genFlow, onAnalyze, isAnalyzing, onOpenGen, onDismissGen, onOpenReport, onDeleteStock }: {
  stock: Stock;
  reports: ReportSummary[];
  latestReport: ReportSummary | null;
  genFlow: GenFlowState | null;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  onOpenGen: () => void;
  onDismissGen: () => void;
  onOpenReport: (id: number) => void;
  onDeleteStock: () => void;
}) {
  const banner = genFlow ? <GenProgressBanner flow={genFlow} onOpen={onOpenGen} onDismiss={onDismissGen} /> : null;
  const latestFull = reports[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [heroData, setHeroData] = useState<Record<string, any> | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [headlineExpanded, setHeadlineExpanded] = useState(false);
  const headlineRef = useRef<HTMLDivElement>(null);
  const [headlineClamped, setHeadlineClamped] = useState(false);

  useEffect(() => {
    if (latestFull) {
      api.getReport(latestFull.id).then(full => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setHeroData(full.result_json as Record<string, any>);
      }).catch(() => {});
    } else {
      setHeroData(null);
    }
  }, [latestFull?.id]);

  useEffect(() => {
    setCurrentPrice(null);
    simApi.getQuote(stock.ticker).then(q => {
      const p = (q as Record<string, unknown>).price ?? (q as Record<string, unknown>).current;
      if (typeof p === "number") setCurrentPrice(p);
    }).catch(() => {});
  }, [stock.ticker]);

  const decision = heroData?.decision ?? {};
  const reportData = heroData?.report ?? {};
  const headline = reportData?.investmentSummary ?? reportData?.coreThesis?.[0] ?? "";

  useEffect(() => {
    const el = headlineRef.current;
    if (!el) return;
    setHeadlineClamped(el.scrollHeight > el.clientHeight + 1);
  }, [headline]);

  if (!latestReport) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <StockHeaderBar stock={stock} onDeleteStock={onDeleteStock} />
        <Card padded={false}>
          <div style={{ padding: "80px 40px", textAlign: "center" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 18px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--sim-text-mute)" strokeWidth="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>该标的尚未生成投研报告</div>
            <div style={{ fontSize: 12.5, color: "var(--sim-text-mute)", marginBottom: 18 }}>
              Agent 会基于行情、基本面、新闻、研报等多维数据综合分析
            </div>
            <Btn kind="primary" size="md" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? "分析中..." : "立即生成报告"}
            </Btn>
          </div>
        </Card>
        {banner}
      </div>
    );
  }

  const analysis = heroData?.analysis ?? {};
  const action = normalizeAction(latestFull?.action ?? decision?.action);
  const confidence = latestFull?.confidence ?? decision?.confidence;
  const targetPrice = latestFull?.target_price ?? decision?.targetPrice;
  const risks = Array.isArray(reportData?.risks) ? reportData.risks : (Array.isArray(analysis?.risks) ? analysis.risks : []);
  const catalysts = Array.isArray(reportData?.catalysts) ? reportData.catalysts : [];
  const timeHorizon = decision?.timeHorizon;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StockHeaderBar stock={stock} onDeleteStock={onDeleteStock} />

      <Card padded={false} style={{ overflow: "hidden" }}>
        <div style={{
          padding: "20px 28px",
          background: verdictGradient(action), color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24,
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: "var(--sim-mono)", fontSize: 26, fontWeight: 700, letterSpacing: "0.06em" }}>
                {action.toUpperCase()}
              </span>
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.16)", fontFamily: "var(--sim-mono)", fontSize: 11, fontWeight: 600 }}>
                v{reports.length}
              </span>
            </div>
            <div>
              <div
                ref={headlineRef}
                style={{
                  fontSize: 14, fontWeight: 500, lineHeight: 1.55, maxWidth: 720, opacity: 0.95,
                  transition: "max-height 0.18s ease",
                  ...(headlineExpanded ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
                }}
              >
                {typeof headline === "string" ? headline : ""}
              </div>
              {headlineClamped && (
                <span
                  onClick={() => setHeadlineExpanded(v => !v)}
                  style={{
                    fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)", cursor: "pointer",
                    userSelect: "none", marginTop: 6, display: "inline-flex", alignItems: "center", gap: 3,
                    padding: "4px 6px", borderRadius: 6, transition: "background 0.12s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {headlineExpanded ? "收起" : "展开摘要"}
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transition: "transform 0.12s", transform: headlineExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              )}
            </div>
          </div>
          {timeHorizon && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: "0.04em" }}>时间窗</div>
              <div style={{ fontSize: 12.5, marginTop: 4, maxWidth: 280, lineHeight: 1.4 }}>{String(timeHorizon)}</div>
            </div>
          )}
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto",
          gap: 0, padding: "18px 28px", borderBottom: "1px solid var(--sim-hairline)",
        }}>
          <KpiCol label="目标价" value={`¥${fmtNum(targetPrice, 2)}`} />
          <KpiCol label="现价" value={currentPrice !== null ? `¥${currentPrice.toFixed(2)}` : "-"} />
          <KpiCol label="预期空间" value={currentPrice !== null && typeof targetPrice === "number" && currentPrice > 0 ? `${((targetPrice - currentPrice) / currentPrice * 100).toFixed(1)}%` : "-"} />
          <KpiCol label="置信度" value={fmtPct(confidence)} />
          <KpiCol label="风险等级" value={risks.length > 3 ? "高" : risks.length > 1 ? "中" : "低"} />
          <div style={{ display: "flex", alignItems: "center" }}>
            <Btn kind="primary" size="md" onClick={() => latestFull && onOpenReport(latestFull.id)}>查看完整报告</Btn>
          </div>
        </div>

        {(risks.length > 0 || catalysts.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--sim-hairline)" }}>
            <div style={{ background: "var(--sim-surface)", padding: "18px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-down)" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-text)", letterSpacing: "0.02em" }}>关键风险</span>
                <Tag kind="down" size="sm">{risks.length}</Tag>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {risks.slice(0, 4).map((r: unknown, i: number) => (
                  <RiskItem key={i} text={toText(r)} level="warn" />
                ))}
              </div>
            </div>
            <div style={{ background: "var(--sim-surface)", padding: "18px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-up)" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-text)", letterSpacing: "0.02em" }}>潜在机会</span>
                <Tag kind="up" size="sm">{catalysts.length}</Tag>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {catalysts.slice(0, 4).map((c: unknown, i: number) => (
                  <RiskItem key={i} text={toText(c)} level="info" />
                ))}
                {catalysts.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>暂无数据</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {reports.length > 1 && (
        <Card padded={false} style={{ padding: "18px 28px" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>评级与目标价演进</div>
            <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginTop: 2 }}>{reports.length} 个版本</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(reports.length, 6)}, 1fr)`, gap: 12 }}>
            {reports.slice(0, 6).map((r, i) => {
              const isLatest = i === 0;
              return (
                <div key={r.id} onClick={() => onOpenReport(r.id)} style={{
                  position: "relative", padding: "12px 14px", cursor: "pointer",
                  background: isLatest ? "var(--sim-bg-soft)" : "var(--sim-surface-2)",
                  border: `1px solid ${isLatest ? "var(--sim-brand)" : "var(--sim-hairline)"}`,
                  borderRadius: 8,
                }}>
                  {isLatest && (
                    <div style={{
                      position: "absolute", top: -8, right: 8,
                      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
                      padding: "2px 6px", background: "var(--sim-brand)", color: "#fff", borderRadius: 3,
                    }}>LATEST</div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, fontWeight: 600, color: "var(--sim-text-mute)" }}>v{reports.length - i}</span>
                    <ActionTag action={normalizeAction(r.action)} size="sm" />
                  </div>
                  <div style={{ fontFamily: "var(--sim-mono)", fontSize: 16, fontWeight: 600 }}>
                    ¥{typeof r.target_price === "number" ? r.target_price.toFixed(2) : "-"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sim-text-mute)", marginTop: 6, fontFamily: "var(--sim-mono)" }}>
                    {new Date(r.created_at).toLocaleDateString("zh-CN")}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sim-text-faint)", fontFamily: "var(--sim-mono)" }}>
                    置信 {typeof r.confidence === "number" ? (r.confidence * 100).toFixed(0) : "-"}%
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--sim-hairline)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>历史研报</div>
          <Btn kind="primary" size="sm" onClick={onAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? "分析中..." : "开始分析"}
          </Btn>
        </div>
        <div style={{ padding: "12px 24px" }}>
          {reports.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>暂无分析报告</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {reports.map(r => (
                <div key={r.id} onClick={() => onOpenReport(r.id)} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  borderRadius: 8, cursor: "pointer", border: "1px solid var(--sim-hairline)",
                  background: "var(--sim-surface)",
                }}>
                  <ActionTag action={normalizeAction(r.action)} size="sm" />
                  <span style={{ fontFamily: "var(--sim-mono)", fontSize: 12 }}>置信度 {typeof r.confidence === "number" ? (r.confidence * 100).toFixed(0) : "-"}%</span>
                  <span style={{ fontFamily: "var(--sim-mono)", fontSize: 12 }}>目标 ¥{typeof r.target_price === "number" ? r.target_price.toFixed(2) : "-"}</span>
                  <span style={{ fontSize: 11, color: "var(--sim-text-mute)", marginLeft: "auto" }}>
                    {relativeTime(r.created_at)}
                  </span>
                  <span style={{ color: "var(--sim-brand)", fontSize: 12, fontWeight: 500 }}>查看</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {banner}
    </div>
  );
}

function StockHeaderBar({ stock, onDeleteStock }: { stock: Stock; onDeleteStock: () => void }) {
  return (
    <Card padded={false} style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>{stock.name || stock.ticker}</span>
            <span style={{ fontFamily: "var(--sim-mono)", fontSize: 13, color: "var(--sim-text-mute)" }}>{stock.exchange}.{stock.ticker}</span>
            {stock.sector && <Tag kind="ghost" size="sm">{stock.sector}</Tag>}
          </div>
          {stock.notes && <div style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>{stock.notes}</div>}
        </div>
        <Btn kind="ghost" size="sm" onClick={onDeleteStock}>删除标的</Btn>
      </div>
    </Card>
  );
}

function KpiCol({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "var(--sim-mono)", color: color ?? "var(--sim-text)" }}>{value}</div>
    </div>
  );
}

function RiskItem({ text, level }: { text: string; level: "critical" | "warn" | "info" }) {
  const meta = {
    critical: { color: "var(--sim-down)", bg: "var(--sim-down-soft)", icon: "!" },
    warn: { color: "#9A6700", bg: "#FFF6E0", icon: "!" },
    info: { color: "var(--sim-up)", bg: "var(--sim-up-soft)", icon: "+" },
  }[level];
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{
        width: 16, height: 16, borderRadius: 4, marginTop: 1,
        background: meta.bg, color: meta.color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, fontFamily: "var(--sim-mono)", flexShrink: 0,
      }}>{meta.icon}</div>
      <div style={{ fontSize: 12, color: "var(--sim-text-soft)", lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

type SectionDef = { id: string; title: string; severity?: string; severityLabel?: string };

function ReportDetailView({ report, ticker, onBack, onDelete }: {
  report: ReportFull;
  ticker: string;
  onBack: () => void;
  onDelete: (id: number) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = report.result_json as Record<string, any>;
  const analysis = data?.analysis ?? {};
  const investReport = data?.report ?? {};
  const decision = data?.decision ?? {};
  const bullCase = data?.bullCase ?? {};
  const bearCase = data?.bearCase ?? {};
  const vr = investReport?.valuationRange;

  const action = normalizeAction(decision?.action);
  const confidence = decision?.confidence;
  const targetPrice = decision?.targetPrice;
  const risks = Array.isArray(investReport?.risks) ? investReport.risks : (Array.isArray(analysis?.risks) ? analysis.risks : []);
  const catalysts = Array.isArray(investReport?.catalysts) ? investReport.catalysts : [];
  const headline = investReport?.investmentSummary ?? investReport?.coreThesis?.[0] ?? "";

  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [headlineExpanded, setHeadlineExpanded] = useState(false);
  const headlineRef = useRef<HTMLDivElement>(null);
  const [headlineClamped, setHeadlineClamped] = useState(false);
  useEffect(() => {
    const el = headlineRef.current;
    if (!el) return;
    setHeadlineClamped(el.scrollHeight > el.clientHeight + 1);
  }, [headline]);
  useEffect(() => {
    if (!ticker) return;
    simApi.getQuote(ticker).then(q => {
      const p = (q as Record<string, unknown>).price ?? (q as Record<string, unknown>).current;
      if (typeof p === "number") setCurrentPrice(p);
    }).catch(() => {});
  }, [ticker]);

  const sections = useMemo<SectionDef[]>(() => {
    const list: SectionDef[] = [];
    if (analysis?.companyOverview) list.push({ id: "sec-overview", title: "公司概况" });
    if (analysis?.financialQuality) list.push({ id: "sec-finance", title: "财务质量" });
    if (analysis?.growth) list.push({ id: "sec-growth", title: "成长性" });
    if (analysis?.profitability) list.push({ id: "sec-profit", title: "盈利能力" });
    if (analysis?.cashFlow) list.push({ id: "sec-cash", title: "现金流" });
    if (analysis?.valuation || vr) list.push({ id: "sec-valuation", title: "估值" });
    if (investReport?.coreThesis || investReport?.investmentSummary) list.push({ id: "sec-thesis", title: "核心观点" });
    if (bullCase?.summary || bearCase?.summary) list.push({ id: "sec-bullbear", title: "多空观点" });
    if (decision?.action) list.push({ id: "sec-decision", title: "投资决策" });
    list.push({ id: "sec-raw", title: "原始数据" });
    return list;
  }, [data]);

  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) setActiveSection(e.target.id);
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    sections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [report.id, sections]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 16, alignItems: "flex-start", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            border: "1px solid var(--sim-border)", background: "var(--sim-surface)",
            padding: "6px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer",
            color: "var(--sim-text-soft)", fontFamily: "var(--sim-sans)",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            返回列表
          </button>
          <span style={{ fontSize: 12, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)" }}>
            #{report.id} · {new Date(report.created_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
          <div style={{ flex: 1 }} />
          <Btn kind="ghost" size="sm" onClick={() => onDelete(report.id)}>删除</Btn>
        </div>

        <Card padded={false} style={{ overflow: "hidden" }}>
          <div style={{
            padding: "20px 28px",
            background: verdictGradient(action), color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24,
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--sim-mono)", fontSize: 26, fontWeight: 700, letterSpacing: "0.06em" }}>
                  {action.toUpperCase()}
                </span>
                <span style={{ opacity: 0.7, fontFamily: "var(--sim-mono)", fontSize: 12 }}>#{report.id}</span>
              </div>
              <div>
                <div
                  ref={headlineRef}
                  style={{
                    fontSize: 14, fontWeight: 500, lineHeight: 1.55, maxWidth: 720, opacity: 0.95,
                    transition: "max-height 0.18s ease",
                    ...(headlineExpanded ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
                  }}
                >
                  {typeof headline === "string" ? headline : ""}
                </div>
                {headlineClamped && (
                  <span
                    onClick={() => setHeadlineExpanded(v => !v)}
                    style={{
                      fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)", cursor: "pointer",
                      userSelect: "none", marginTop: 6, display: "inline-flex", alignItems: "center", gap: 3,
                      padding: "4px 6px", borderRadius: 6, transition: "background 0.12s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {headlineExpanded ? "收起" : "展开摘要"}
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transition: "transform 0.12s", transform: headlineExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                )}
              </div>
            </div>
            {decision?.timeHorizon && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: "0.04em" }}>时间窗</div>
                <div style={{ fontSize: 12.5, marginTop: 4, maxWidth: 280, lineHeight: 1.4 }}>{String(decision.timeHorizon)}</div>
              </div>
            )}
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
            gap: 0, padding: "18px 28px", borderBottom: "1px solid var(--sim-hairline)",
          }}>
            <KpiCol label="目标价" value={`¥${fmtNum(targetPrice, 2)}`} />
            <KpiCol label="现价" value={currentPrice !== null ? `¥${currentPrice.toFixed(2)}` : "-"} />
            <KpiCol label="预期空间" value={currentPrice !== null && typeof targetPrice === "number" && currentPrice > 0 ? `${((targetPrice - currentPrice) / currentPrice * 100).toFixed(1)}%` : "-"} />
            <KpiCol label="置信度" value={fmtPct(confidence)} />
            <KpiCol label="风险等级" value={risks.length > 3 ? "极高" : risks.length > 1 ? "中" : "低"} />
          </div>

          {(risks.length > 0 || catalysts.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--sim-hairline)" }}>
              <div style={{ background: "var(--sim-surface)", padding: "18px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-down)" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-text)", letterSpacing: "0.02em" }}>关键风险</span>
                  <Tag kind="down" size="sm">{risks.length}</Tag>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {risks.map((r: unknown, i: number) => (
                    <RiskItem key={i} text={toText(r)} level="warn" />
                  ))}
                </div>
              </div>
              <div style={{ background: "var(--sim-surface)", padding: "18px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-up)" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-text)", letterSpacing: "0.02em" }}>潜在机会</span>
                  <Tag kind="up" size="sm">{catalysts.length}</Tag>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {catalysts.map((c: unknown, i: number) => (
                    <RiskItem key={i} text={toText(c)} level="info" />
                  ))}
                  {catalysts.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>暂无数据</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>

        {analysis?.companyOverview && (
          <div id="sec-overview" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="公司概况">
              <RSection content={analysis.companyOverview} />
            </SectionCard>
          </div>
        )}

        {analysis?.financialQuality && (
          <div id="sec-finance" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="财务质量">
              <RSection content={analysis.financialQuality} />
            </SectionCard>
          </div>
        )}

        {analysis?.growth && (
          <div id="sec-growth" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="成长性">
              <RSection content={analysis.growth} />
            </SectionCard>
          </div>
        )}

        {analysis?.profitability && (
          <div id="sec-profit" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="盈利能力">
              <RSection content={analysis.profitability} />
            </SectionCard>
          </div>
        )}

        {analysis?.cashFlow && (
          <div id="sec-cash" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="现金流">
              <RSection content={analysis.cashFlow} />
            </SectionCard>
          </div>
        )}

        {(analysis?.valuation || vr) && (
          <div id="sec-valuation" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="估值">
              <RSection content={analysis?.valuation} />
              {vr && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>估值区间</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    <MetricBox label="悲观" value={`¥${fmtNum(vr?.low, 2)}`} />
                    <MetricBox label="基准" value={`¥${fmtNum(vr?.base, 2)}`} />
                    <MetricBox label="乐观" value={`¥${fmtNum(vr?.high, 2)}`} />
                  </div>
                  {typeof vr?.method === "string" && <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 6 }}>{vr.method}</div>}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {(investReport?.coreThesis || investReport?.investmentSummary) && (
          <div id="sec-thesis" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="核心观点">
              {investReport?.investmentSummary && <RSection content={investReport.investmentSummary} />}
              {Array.isArray(investReport?.coreThesis) && investReport.coreThesis.length > 0 && (
                <div style={{ marginTop: investReport?.investmentSummary ? 16 : 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>核心论点</div>
                  <RListSection items={investReport.coreThesis} />
                </div>
              )}
              {investReport?.financialAnalysis && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>财务分析</div>
                  <RSection content={investReport.financialAnalysis} />
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {(bullCase?.summary || bearCase?.summary) && (
          <div id="sec-bullbear" style={{ scrollMarginTop: 80 }}>
            <SectionCard title="多空观点">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-up)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>多头观点</span>
                    {typeof bullCase?.conviction === "number" && (
                      <Tag kind="up" size="sm">置信 {(bullCase.conviction * 100).toFixed(0)}%</Tag>
                    )}
                  </div>
                  {bullCase?.summary && (
                    <div style={{ padding: "12px 16px", background: "var(--sim-up-soft)", borderRadius: 8, border: "1px solid #F5C7CE", fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)", marginBottom: 10 }}>
                      {String(bullCase.summary)}
                    </div>
                  )}
                  {Array.isArray(bullCase?.coreArguments) && bullCase.coreArguments.length > 0 && (
                    <RListSection items={bullCase.coreArguments} />
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-down)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>空头观点</span>
                    {typeof bearCase?.conviction === "number" && (
                      <Tag kind="down" size="sm">置信 {(bearCase.conviction * 100).toFixed(0)}%</Tag>
                    )}
                  </div>
                  {bearCase?.summary && (
                    <div style={{ padding: "12px 16px", background: "var(--sim-down-soft)", borderRadius: 8, border: "1px solid #C7E3D4", fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)", marginBottom: 10 }}>
                      {String(bearCase.summary)}
                    </div>
                  )}
                  {Array.isArray(bearCase?.coreArguments) && bearCase.coreArguments.length > 0 && (
                    <RListSection items={bearCase.coreArguments} />
                  )}
                </div>
              </div>
              {investReport?.bearCase && typeof investReport.bearCase === "string" && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>熊市情景</div>
                  <RSection content={investReport.bearCase} />
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {decision?.action && (
          <div id="sec-decision" style={{ scrollMarginTop: 80 }}>
            <Card padded={false} style={{ padding: "22px 28px", background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>投资决策建议</span>
                <Tag kind="brand" size="sm">Agent</Tag>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                <MetricBox label="建议操作" value={String(decision?.action ?? "-").toUpperCase()} />
                <MetricBox label="置信度" value={fmtPct(decision?.confidence)} />
                <MetricBox label="目标价" value={`¥${fmtNum(decision?.targetPrice, 2)}`} />
                <MetricBox label="时间窗口" value={typeof decision?.timeHorizon === "string" ? decision.timeHorizon : "-"} />
              </div>

              {Array.isArray(decision?.rationale) && decision.rationale.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>投资依据</div>
                  <RListSection items={decision.rationale} />
                </div>
              )}
              {Array.isArray(decision?.riskWarnings) && decision.riskWarnings.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>风险警示</div>
                  <RListSection items={decision.riskWarnings} />
                </div>
              )}
              {Array.isArray(decision?.assumptions) && decision.assumptions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>假设前提</div>
                  <RListSection items={decision.assumptions} />
                </div>
              )}
              {decision?.suitability && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>适用说明</div>
                  <RSection content={decision.suitability} />
                </div>
              )}
            </Card>
          </div>
        )}

        <div id="sec-raw" style={{ scrollMarginTop: 80 }}>
          <SectionCard title="原始数据">
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <Btn kind="ghost" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}>复制 JSON</Btn>
              <Btn kind="ghost" size="sm" onClick={() => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `report-${report.id}.json`; a.click();
                URL.revokeObjectURL(url);
              }}>下载 JSON</Btn>
            </div>
            <pre style={{
              padding: 16, background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)",
              fontSize: 11.5, lineHeight: 1.5, overflow: "auto", maxHeight: 500, fontFamily: "var(--sim-mono)",
              whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>{JSON.stringify(data, null, 2)}</pre>
          </SectionCard>
        </div>
      </div>

      <Card padded={false} style={{ position: "sticky", top: 80, padding: "14px 4px 14px 0" }}>
        <div style={{ padding: "0 16px 10px", fontSize: 11, fontWeight: 600, color: "var(--sim-text-mute)", letterSpacing: "0.06em" }}>
          报告章节
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {sections.map(s => {
            const isActive = s.id === activeSection;
            return (
              <a key={s.id} href={`#${s.id}`}
                onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ block: "start", behavior: "smooth" }); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px",
                  borderLeft: isActive ? "2px solid var(--sim-brand)" : "2px solid transparent",
                  background: isActive ? "var(--sim-bg-soft)" : "transparent",
                  fontSize: 12.5,
                  color: isActive ? "var(--sim-brand)" : "var(--sim-text-soft)",
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: "none",
                  cursor: "pointer",
                }}>
                <span style={{ flex: 1 }}>{s.title}</span>
                {s.severity === "critical" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sim-down)" }} />}
                {s.severity === "warn" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9A6700" }} />}
              </a>
            );
          })}
        </div>
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--sim-hairline)", marginTop: 6 }}>
          <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginBottom: 6 }}>生成时间</div>
          <div style={{ fontFamily: "var(--sim-mono)", fontSize: 12, fontWeight: 500 }}>
            {new Date(report.created_at).toLocaleString("zh-CN")}
          </div>
        </div>
      </Card>
    </div>
  );
}

function SectionCard({ title, severity, severityLabel, children }: {
  title: string;
  severity?: string;
  severityLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid var(--sim-hairline)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          {severity === "critical" && severityLabel && <Tag kind="down" size="sm">{severityLabel}</Tag>}
          {severity === "warn" && severityLabel && <Tag kind="warn" size="sm">{severityLabel}</Tag>}
        </div>
      </div>
      <div style={{ padding: "20px 24px" }}>
        {children}
      </div>
    </Card>
  );
}

function RSection({ content }: { content?: unknown }) {
  if (content == null || content === "") return null;
  if (typeof content === "string") {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--sim-text-soft)", padding: "12px 16px", background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)" }}>
        {content}
      </div>
    );
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    const entries = Object.entries(content as Record<string, unknown>)
      .map(([key, val]) => { const text = toText(val); return text ? { key, text } : null; })
      .filter((x): x is { key: string; text: string } => x !== null);
    if (entries.length > 0) {
      return (
        <div style={{ padding: "12px 16px", background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)" }}>
          {entries.map(({ key, text }) => (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--sim-text-mute)", fontWeight: 600, marginBottom: 2 }}>{key}</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)" }}>{text}</div>
            </div>
          ))}
        </div>
      );
    }
  }
  const fallback = toText(content);
  if (!fallback) return null;
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)", padding: "12px 16px", background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)" }}>
      {fallback}
    </div>
  );
}

function RListSection({ items }: { items?: unknown[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ padding: "12px 16px", background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)" }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: i < items.length - 1 ? 8 : 0 }}>
          <span style={{ color: "var(--sim-brand)", flexShrink: 0 }}>•</span>
          <span style={{ fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)" }}>{toText(item)}</span>
        </div>
      ))}
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "12px 16px", background: "var(--sim-surface-2)", borderRadius: 8, border: "1px solid var(--sim-hairline)" }}>
      <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--sim-mono)", fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function AddStockDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (stock: Stock) => void }) {
  const [ticker, setTicker] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError("");
    const trimmed = ticker.trim();
    if (!/^\d{6}$/.test(trimmed)) { setError("请输入6位数字股票代码"); return; }
    setLoading(true);
    try {
      const stock = await api.createStock(trimmed);
      onCreated(stock);
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally { setLoading(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--sim-bg)", borderRadius: 12, padding: "24px 28px", width: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", border: "1px solid var(--sim-border)" }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>添加股票</div>
        <div style={{ fontSize: 12, color: "var(--sim-text-mute)", marginBottom: 16, lineHeight: 1.5 }}>
          输入股票代码，名称和行业将自动查询补全
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--sim-text-soft)", display: "block", marginBottom: 6 }}>股票代码</label>
            <input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="600519" maxLength={6} autoFocus
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--sim-border-strong)", fontSize: 14, fontFamily: "var(--sim-mono)", outline: "none", boxSizing: "border-box", background: "var(--sim-surface)" }} />
          </div>
          {error && <div style={{ color: "var(--sim-down)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--sim-border)", background: "var(--sim-surface)", cursor: "pointer", fontSize: 13, fontFamily: "var(--sim-sans)" }}>取消</button>
            <button type="submit" disabled={loading} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--sim-brand)", color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--sim-sans)" }}>
              {loading ? "查询中..." : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--sim-bg)", borderRadius: 12, padding: "24px 28px", width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", border: "1px solid var(--sim-border)" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>确认操作</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--sim-text-soft)", marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--sim-border)", background: "var(--sim-surface)", cursor: "pointer", fontSize: 13, fontFamily: "var(--sim-sans)" }}>取消</button>
          <button onClick={onConfirm} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--sim-up)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--sim-sans)" }}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function BatchPanel({ batch, onDismiss }: {
  batch: { running: boolean; total: number; completed: number; failed: number;
    current: { ticker: string; name: string; attempt: number } | null;
    results: Array<{ ticker: string; name: string; status: string; error?: string; attempts: number }> };
  onDismiss: () => void;
}) {
  const pct = batch.total > 0 ? ((batch.completed + batch.failed) / batch.total * 100) : 0;
  return (
    <Card padded={false}>
      <div style={{ padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {batch.running && <PulseDot color="var(--sim-up)" />}
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {batch.running ? "批量生成报告中" : "批量生成完成"}
            </span>
            <span style={{ fontSize: 12, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)" }}>
              {batch.completed + batch.failed}/{batch.total}
            </span>
          </div>
          {!batch.running && (
            <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--sim-text-faint)", cursor: "pointer", fontSize: 13 }}>✕</button>
          )}
        </div>

        <div style={{ height: 4, background: "var(--sim-border)", borderRadius: 2, marginBottom: 12 }}>
          <div style={{
            height: "100%", borderRadius: 2, transition: "width 0.3s ease",
            width: `${pct}%`,
            background: batch.failed > 0 ? "linear-gradient(90deg, var(--sim-up) 0%, var(--sim-down) 100%)" : "var(--sim-up)",
          }} />
        </div>

        {batch.current && (
          <div style={{ fontSize: 12, color: "var(--sim-text-soft)", marginBottom: 8 }}>
            正在分析: <span style={{ fontWeight: 500 }}>{batch.current.name}</span>
            <span style={{ fontFamily: "var(--sim-mono)", marginLeft: 6 }}>{batch.current.ticker}</span>
            {batch.current.attempt > 1 && <span style={{ color: "var(--sim-down)", marginLeft: 6 }}>(第 {batch.current.attempt} 次尝试)</span>}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {batch.results.map((r, i) => (
            <div key={i} title={r.error ? `${r.name}: ${r.error}` : r.name} style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "var(--sim-mono)",
              border: "1px solid var(--sim-hairline)",
              background: r.status === "completed" ? "var(--sim-up-soft)" :
                          r.status === "failed" ? "var(--sim-down-soft)" :
                          r.status === "running" ? "#FEF3C7" : "var(--sim-surface-2)",
              color: r.status === "completed" ? "var(--sim-up)" :
                     r.status === "failed" ? "var(--sim-down)" :
                     r.status === "running" ? "#92400E" : "var(--sim-text-mute)",
              fontWeight: r.status === "running" ? 600 : 400,
            }}>
              {r.ticker}
              {r.status === "failed" && r.attempts > 1 && ` x${r.attempts}`}
            </div>
          ))}
        </div>

        {!batch.running && (batch.completed > 0 || batch.failed > 0) && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--sim-text-mute)" }}>
            {batch.completed > 0 && <span style={{ color: "var(--sim-up)" }}>{batch.completed} 成功</span>}
            {batch.completed > 0 && batch.failed > 0 && <span> · </span>}
            {batch.failed > 0 && <span style={{ color: "var(--sim-down)" }}>{batch.failed} 失败</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

function SimToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
      padding: "10px 20px", borderRadius: 8, background: "#1F1F1F", color: "#fff", fontSize: 13,
      boxShadow: "0 4px 20px rgba(0,0,0,0.2)", cursor: "pointer",
    }} onClick={onClose}>{message}</div>
  );
}

function LlmHintDialog({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--sim-bg)", borderRadius: 12, padding: "24px 28px", width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", border: "1px solid var(--sim-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: "#FCE8EC",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sim-up)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>大模型未配置</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)", marginBottom: 20 }}>
          尚未配置大模型 API Key，无法生成投研报告。请先前往<b>「设置」</b>页面配置大模型服务商。
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn kind="primary" size="md" onClick={onClose}>知道了</Btn>
        </div>
      </div>
    </div>
  );
}

function TushareHintDialog({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--sim-bg)", borderRadius: 12, padding: "24px 28px", width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", border: "1px solid var(--sim-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: "#FEF3C7",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Tushare 未配置</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--sim-text-soft)", marginBottom: 20 }}>
          尚未配置 Tushare Token，添加股票后将无法自动获取名称、行业等基本信息。请先前往<b>「设置」</b>页面配置数据源。
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn kind="ghost" size="md" onClick={onCancel}>取消</Btn>
          <Btn kind="soft" size="md" onClick={onContinue}>仍然添加</Btn>
        </div>
      </div>
    </div>
  );
}
