import { useState, useEffect, useCallback, useRef } from "react";
import { simApi } from "../api";
import { Card } from "../components/Card";
import { Tag, ActionTag } from "../components/Tag";
import { Tabs } from "../components/Tabs";
import { Btn } from "../components/Btn";
import { PulseDot } from "../components/PulseDot";
import { fmtMoney, fmtDate } from "../utils";
import type { SimDecision, SchedulerStatus } from "../types";

export function AgentPage({ initialDecisionId }: { initialDecisionId?: number }) {
  const [decisions, setDecisions] = useState<SimDecision[]>([]);
  const [selected, setSelected] = useState<SimDecision | null>(null);
  const [filter, setFilter] = useState("all");
  const [detailTab, setDetailTab] = useState("rationale");
  const [scheduler, setScheduler] = useState<SchedulerStatus>({ running: false, lastRunAt: null, nextRunAt: null });
  const [runningOnce, setRunningOnce] = useState(false);
  const didInitialSelect = useRef(false);
  const needsScroll = useRef(!!initialDecisionId);

  const refreshScheduler = useCallback(() => {
    simApi.getSchedulerStatus().then(setScheduler).catch(() => {});
  }, []);

  useEffect(() => {
    refreshScheduler();
    const id = setInterval(refreshScheduler, 5000);
    return () => clearInterval(id);
  }, [refreshScheduler]);

  const refreshDecisions = useCallback(() => {
    const params: Record<string, string> = {};
    if (filter !== "all") params.action = filter;
    simApi.getDecisions({ limit: 100, ...params }).then(r => {
      setDecisions(r.data);
      if (didInitialSelect.current) return;
      didInitialSelect.current = true;
      const targetId = initialDecisionId ?? r.data[0]?.id;
      if (targetId) {
        simApi.getDecision(targetId).then(setSelected).catch(() => {
          const found = r.data.find(d => d.id === targetId);
          if (found) setSelected(found);
        });
      }
    }).catch(() => {});
  }, [filter, initialDecisionId]);

  useEffect(() => {
    refreshDecisions();
  }, [refreshDecisions]);

  const toggleScheduler = async () => {
    if (scheduler.running) {
      await simApi.stopScheduler();
    } else {
      await simApi.startScheduler();
    }
    refreshScheduler();
  };

  const handleRunOnce = async (force: boolean) => {
    setRunningOnce(true);
    try {
      await simApi.runOnce(force);
      refreshScheduler();
      refreshDecisions();
    } catch {} finally {
      setRunningOnce(false);
    }
  };

  const selectDecision = (d: SimDecision) => {
    simApi.getDecision(d.id).then(setSelected).catch(() => setSelected(d));
  };

  const filtered = decisions.filter(d => {
    if (filter === "all") return true;
    return d.action === filter;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: "calc(100vh - 120px)" }}>
      {/* Scheduler Control Panel */}
      <Card padded={false}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <PulseDot color={scheduler.running ? "var(--sim-down)" : "var(--sim-text-faint)"} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                Agent 调度器 · {scheduler.running ? "运行中" : "已停止"}
              </span>
            </div>
            <div style={{ height: 16, width: 1, background: "var(--sim-border-strong)" }} />
            <div style={{ fontSize: 12, color: "var(--sim-text-mute)", display: "flex", gap: 16 }}>
              <span>上次运行: <span style={{ fontFamily: "var(--sim-mono)" }}>{scheduler.lastRunAt ? fmtDate(scheduler.lastRunAt) : "—"}</span></span>
              <span>下次运行: <span style={{ fontFamily: "var(--sim-mono)" }}>{scheduler.nextRunAt ? fmtDate(scheduler.nextRunAt) : "—"}</span></span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Btn kind={scheduler.running ? "danger" : "primary"} size="sm" onClick={toggleScheduler}>
              {scheduler.running ? "停止调度" : "启动调度"}
            </Btn>
            <Btn kind="ghost" size="sm" onClick={() => handleRunOnce(false)} disabled={runningOnce}>
              {runningOnce ? "运行中..." : "执行一次"}
            </Btn>
            <Btn kind="soft" size="sm" onClick={() => handleRunOnce(true)} disabled={runningOnce}>
              强制执行
            </Btn>
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, flex: "1 0 auto" }}>
        {/* Left: Decision List */}
        <Card padded={false} style={{ position: "sticky", top: 80, height: "calc(100vh - 180px)", overflow: "hidden", alignSelf: "start" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--sim-hairline)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>决策记录</div>
              <Tag kind="brand" size="sm">{decisions.length} 条</Tag>
            </div>
            <Tabs value={filter} onChange={setFilter} tabs={[
              { value: "all", label: "全部" },
              { value: "buy", label: "买入" },
              { value: "sell", label: "卖出" },
              { value: "hold", label: "观望" },
            ]} size="sm" />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map(d => {
              const active = d.id === selected?.id;
              const timeStr = fmtDate(d.createdAt).split(" ")[1]?.slice(0, 5) ?? "";
              return (
                <div key={d.id} ref={d.id === selected?.id && needsScroll.current ? el => { if (el) { el.scrollIntoView({ block: "start" }); needsScroll.current = false; } } : undefined} onClick={() => selectDecision(d)} style={{
                  padding: "14px 16px",
                  borderBottom: "1px solid var(--sim-hairline)",
                  borderLeft: active ? "3px solid var(--sim-brand)" : "3px solid transparent",
                  background: active ? "var(--sim-bg-soft)" : "transparent",
                  cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ActionTag action={d.action} size="sm" />
                      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11.5, color: "var(--sim-brand)", fontWeight: 500 }}>#{d.id}</span>
                    </div>
                    <span style={{ fontFamily: "var(--sim-mono)", fontSize: 10.5, color: "var(--sim-text-mute)" }}>{timeStr}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                    {d.name ?? d.ticker ?? "—"}{" "}
                    {d.ticker && <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)", fontWeight: 400 }}>{d.ticker}</span>}
                  </div>
                  <div style={{
                    fontSize: 11.5, color: "var(--sim-text-soft)", lineHeight: 1.5,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                  }}>
                    {d.reasoning ?? "—"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10.5, color: "var(--sim-text-mute)" }}>置信</span>
                      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, fontWeight: 600 }}>{(d.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <span style={{ color: "var(--sim-text-faint)" }}>·</span>
                    <Tag kind={d.status === "executed" ? "down" : d.status === "rejected" ? "up" : "neutral"} size="sm">
                      {d.status === "executed" ? "已执行" : d.status === "rejected" ? "已拒绝" : "已评估"}
                    </Tag>
                    {d.riskScore && (
                      <Tag kind={d.riskScore === "low" ? "ghost" : d.riskScore === "medium" ? "warn" : "up"} size="sm">
                        风险·{d.riskScore === "low" ? "低" : d.riskScore === "medium" ? "中" : "高"}
                      </Tag>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>暂无决策记录</div>
            )}
          </div>
        </Card>

        {/* Right: Decision Detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {selected ? (
            <>
              {/* Header Card */}
              <Card padded={false} style={{ padding: "22px 26px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <ActionTag action={selected.action} />
                      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 14, fontWeight: 500, color: "var(--sim-brand)" }}>#{selected.id}</span>
                      <span style={{ color: "var(--sim-text-faint)" }}>·</span>
                      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 12.5, color: "var(--sim-text-mute)" }}>{fmtDate(selected.createdAt)}</span>
                      <Tag kind={selected.status === "executed" ? "down" : selected.status === "rejected" ? "up" : "neutral"} size="sm">
                        {selected.status === "executed" ? "已执行" : selected.status === "rejected" ? "已拒绝" : "已评估"}
                      </Tag>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
                      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>
                        {selected.action.toUpperCase()} · {selected.name ?? selected.ticker}
                      </h2>
                      {selected.ticker && <span style={{ fontFamily: "var(--sim-mono)", fontSize: 16, color: "var(--sim-text-mute)" }}>{selected.ticker}</span>}
                    </div>

                    {/* Action summary */}
                    {selected.quantity > 0 && selected.price && (
                      <div style={{
                        display: "flex", gap: 24, padding: "14px 18px",
                        background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
                        borderRadius: "var(--sim-r-md)", marginBottom: 14, alignItems: "center",
                      }}>
                        <DSpec label="数量" value={`${selected.quantity.toLocaleString()} 股`} />
                        <DSpec label="价格" value={`¥${selected.price.toFixed(2)}`} />
                        <DSpec label="金额" value={fmtMoney(selected.quantity * selected.price, 2)} />
                        {selected.orderId && <DSpec label="订单" value={`#${selected.orderId}`} />}
                      </div>
                    )}
                  </div>

                  {/* Confidence Ring */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <ConfidenceRing value={selected.confidence} />
                    <span style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>置信度</span>
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 0, marginTop: 4, borderBottom: "1px solid var(--sim-hairline)" }}>
                  {[
                    { v: "rationale", l: "决策推理" },
                    { v: "risk", l: "风控检查" },
                    { v: "report", l: "关联研报" },
                    { v: "execution", l: "执行记录" },
                    { v: "snapshot", l: "组合快照" },
                  ].map(t => {
                    const isActive = t.v === detailTab;
                    return (
                      <button key={t.v} onClick={() => setDetailTab(t.v)} style={{
                        border: "none", background: "transparent",
                        padding: "12px 16px", fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? "var(--sim-text)" : "var(--sim-text-mute)",
                        borderBottom: isActive ? "2px solid var(--sim-brand)" : "2px solid transparent",
                        marginBottom: -1, cursor: "pointer", fontFamily: "var(--sim-sans)",
                      }}>{t.l}</button>
                    );
                  })}
                </div>
              </Card>

              {/* Tab Content */}
              {detailTab === "rationale" && <RationaleTab decision={selected} />}
              {detailTab === "risk" && <RiskTab decision={selected} />}
              {detailTab === "report" && <ReportTab decision={selected} />}
              {detailTab === "execution" && <ExecutionTab decision={selected} />}
              {detailTab === "snapshot" && <SnapshotTab decision={selected} />}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "var(--sim-text-mute)" }}>
              选择一条决策查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function DSpec({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 14, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function ConfidenceRing({ value }: { value: number }) {
  const size = 88, stroke = 8, r = size / 2 - stroke / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * value;
  const color = value > 0.7 ? "var(--sim-down)" : value > 0.5 ? "var(--sim-accent, #9A6700)" : "var(--sim-text-mute)";
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EFEDE7" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--sim-mono)", fontSize: 22, fontWeight: 600,
      }}>
        {(value * 100).toFixed(0)}<span style={{ fontSize: 12, color: "var(--sim-text-mute)", marginLeft: 1 }}>%</span>
      </div>
    </div>
  );
}

function RationaleTab({ decision }: { decision: SimDecision }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
      <Card title="决策依据" subtitle="Agent 推理过程">
        <div style={{
          marginTop: 4, padding: "12px 14px",
          background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
          borderRadius: 8, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap",
          color: "var(--sim-text-soft)",
        }}>
          {decision.reasoning ?? "无推理记录"}
        </div>
        {decision.triggers && decision.triggers.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em", marginBottom: 8 }}>触发信号</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {decision.triggers.map((t: string, i: number) => <Tag key={i} kind="accent" size="md">{t.replace(/_/g, " ")}</Tag>)}
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {decision.marketOutlook && (
          <Card title="市场展望">
            <div style={{
              marginTop: 4, padding: "12px 14px",
              background: "var(--sim-bg-soft)", borderRadius: 8,
              fontSize: 12.5, color: "var(--sim-text-soft)", lineHeight: 1.6,
            }}>
              {decision.marketOutlook}
            </div>
          </Card>
        )}

        <Card title="关键指标" subtitle="决策时快照">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 4 }}>
            <MetricItem label="置信度" value={`${(decision.confidence * 100).toFixed(0)}%`} />
            {decision.price && <MetricItem label="决策价格" value={`¥${decision.price.toFixed(2)}`} />}
            {decision.quantity > 0 && <MetricItem label="交易数量" value={`${decision.quantity} 股`} />}
            {decision.price && decision.quantity > 0 && <MetricItem label="交易金额" value={fmtMoney(decision.price * decision.quantity)} />}
            <MetricItem label="风险等级" value={decision.riskScore === "low" ? "低" : decision.riskScore === "medium" ? "中" : "高"} />
            <MetricItem label="决策周期" value={decision.cycleId ?? "—"} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function MetricItem({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid var(--sim-hairline)" }}>
      <span style={{ fontSize: 12, color: "var(--sim-text-soft)" }}>{label}</span>
      <span style={{
        fontFamily: "var(--sim-mono)", fontSize: 13, fontWeight: 600,
        color: cls === "up" ? "var(--sim-up)" : cls === "down" ? "var(--sim-down)" : undefined,
      }}>{value}</span>
    </div>
  );
}

function RiskTab({ decision }: { decision: SimDecision }) {
  const checks = decision.riskChecks ?? [];
  const allPass = checks.length > 0 && checks.every((c: { pass: boolean }) => c.pass);
  return (
    <Card title="风控检查清单"
      subtitle={checks.length > 0 ? `${checks.length} 项检查 · ${allPass ? "全部通过" : "存在告警"}` : "无检查记录"}
      action={checks.length > 0 ? <Tag kind={allPass ? "down" : "up"}>{allPass ? "✓ 通过" : "✗ 拦截"}</Tag> : undefined}
    >
      {checks.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 4 }}>
          {checks.map((c: { name: string; pass: boolean; value: string }, i: number) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "24px 1fr auto",
              gap: 14, padding: "14px 0",
              borderBottom: i < checks.length - 1 ? "1px solid var(--sim-hairline)" : "none",
              alignItems: "center",
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: c.pass ? "var(--sim-up-bg, #ECFDF5)" : "var(--sim-down-bg, #FEF2F2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {c.pass ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sim-down)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sim-up)" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                )}
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 3, fontFamily: "var(--sim-mono)" }}>{c.value}</div>
              </div>
              <Tag kind={c.pass ? "down" : "up"} size="sm">{c.pass ? "PASS" : "FAIL"}</Tag>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: 30, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>
          无风控检查记录
          {decision.riskAction && (
            <div style={{ marginTop: 8 }}>
              风控结果: <Tag kind={decision.riskAction === "approved" ? "down" : "up"} size="sm">{decision.riskAction}</Tag>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ReportTab({ decision }: { decision: SimDecision }) {
  const lr = decision.linkedReport;
  if (!lr) {
    return (
      <Card title="关联研报">
        <div style={{ padding: "20px 0", color: "var(--sim-text-mute)", fontSize: 13, textAlign: "center" }}>本决策无关联研报</div>
      </Card>
    );
  }

  const rpt = lr.report;
  const dec = lr.decision;
  const valRange = rpt?.valuationRange;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
      <Card title={`研报 #${lr.id} · ${lr.stockName}`}
        subtitle={fmtDate(lr.createdAt)}
        action={dec ? <ActionTag action={dec.action as "buy" | "sell" | "hold"} size="sm" /> : undefined}
      >
        {rpt && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 6, paddingBottom: 14, borderBottom: "1px solid var(--sim-hairline)" }}>
              <DSpec label="评级" value={dec?.action?.toUpperCase() ?? "—"} />
              <DSpec label="目标价" value={dec?.targetPrice ? `¥${dec.targetPrice}` : "—"} />
              <DSpec label="置信度" value={dec ? `${(dec.confidence * 100).toFixed(0)}%` : "—"} />
            </div>
            <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.75, color: "var(--sim-text-soft)" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--sim-text)" }}>投资摘要</h4>
              <p style={{ margin: "0 0 12px" }}>{rpt.investmentSummary}</p>

              {rpt.coreThesis?.length > 0 && (
                <>
                  <h4 style={{ margin: "12px 0 8px", fontSize: 13.5, color: "var(--sim-text)" }}>核心观点</h4>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {rpt.coreThesis.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
                  </ul>
                </>
              )}

              <h4 style={{ margin: "12px 0 8px", fontSize: 13.5, color: "var(--sim-text)" }}>财务分析</h4>
              <p style={{ margin: "0 0 12px" }}>{rpt.financialAnalysis}</p>

              {rpt.catalysts?.length > 0 && (
                <>
                  <h4 style={{ margin: "12px 0 8px", fontSize: 13.5, color: "var(--sim-text)" }}>催化剂</h4>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {rpt.catalysts.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}
                  </ul>
                </>
              )}

              {rpt.risks?.length > 0 && (
                <>
                  <h4 style={{ margin: "12px 0 8px", fontSize: 13.5, color: "var(--sim-text)" }}>主要风险</h4>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {rpt.risks.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {valRange && (
          <Card title="估值区间" subtitle={valRange.currency}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 6 }}>
              <DSpec label="悲观" value={`¥${valRange.low}`} />
              <DSpec label="基准" value={`¥${valRange.base}`} />
              <DSpec label="乐观" value={`¥${valRange.high}`} />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.65, color: "var(--sim-text-soft)" }}>
              {valRange.method}
            </div>
          </Card>
        )}

        {(lr.bullCase || lr.bearCase) && (
          <Card title="多空观点">
            {lr.bullCase && (
              <div style={{ marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-up)" }}>多方</span>
                  <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)" }}>
                    确信度 {(lr.bullCase.conviction * 100).toFixed(0)}%
                  </span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.65, color: "var(--sim-text-soft)" }}>{lr.bullCase.summary}</p>
              </div>
            )}
            {lr.bearCase && (
              <div style={{ marginTop: lr.bullCase ? 14 : 4, paddingTop: lr.bullCase ? 14 : 0, borderTop: lr.bullCase ? "1px solid var(--sim-hairline)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-down)" }}>空方</span>
                  <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)" }}>
                    确信度 {(lr.bearCase.conviction * 100).toFixed(0)}%
                  </span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.65, color: "var(--sim-text-soft)" }}>{lr.bearCase.summary}</p>
              </div>
            )}
          </Card>
        )}

        {dec?.riskWarnings && dec.riskWarnings.length > 0 && (
          <Card title="风险提示">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65, color: "var(--sim-text-soft)" }}>
              {dec.riskWarnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function ExecutionTab({ decision }: { decision: SimDecision }) {
  return (
    <Card title="订单执行详情" subtitle={decision.orderId ? `订单 #${decision.orderId}` : "未执行"}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 4 }}>
        <InfoRow label="最终动作" value={decision.status === "executed" ? "已执行" : decision.status === "rejected" ? "已拒绝" : "已评估"} />
        <InfoRow label="订单 ID" value={decision.orderId ? `#${decision.orderId}` : "—"} />
        <InfoRow label="决策周期" value={decision.cycleId ?? "—"} />
        <InfoRow label="数量" value={decision.quantity > 0 ? `${decision.quantity.toLocaleString()} 股` : "—"} />
        <InfoRow label="价格" value={decision.price ? `¥${decision.price.toFixed(2)}` : "—"} />
        <InfoRow label="金额" value={decision.price && decision.quantity ? fmtMoney(decision.price * decision.quantity) : "—"} />
      </div>
      {decision.riskAction && (
        <div style={{ marginTop: 16, padding: "14px 16px", background: "var(--sim-bg-soft)", borderRadius: 8, border: "1px solid var(--sim-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>风控结果</span>
            <Tag kind={decision.riskAction === "approved" ? "down" : "up"} size="sm">{decision.riskAction}</Tag>
          </div>
        </div>
      )}
    </Card>
  );
}

function SnapshotTab({ decision }: { decision: SimDecision }) {
  return (
    <Card title="决策时组合快照" subtitle="Portfolio snapshot at decision time">
      {decision.portfolioSnapshot ? (
        <pre style={{
          marginTop: 8, padding: 16,
          background: "var(--sim-surface-2)", borderRadius: "var(--sim-r-md)",
          border: "1px solid var(--sim-hairline)", fontSize: 11.5, lineHeight: 1.5,
          overflow: "auto", maxHeight: 400, fontFamily: "var(--sim-mono)",
        }}>
          {JSON.stringify(decision.portfolioSnapshot, null, 2)}
        </pre>
      ) : (
        <div style={{ color: "var(--sim-text-mute)", padding: 30, textAlign: "center", fontSize: 13 }}>无快照数据</div>
      )}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "10px 14px", background: "var(--sim-surface-2)", borderRadius: "var(--sim-r-sm)", border: "1px solid var(--sim-hairline)" }}>
      <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, fontFamily: "var(--sim-mono)" }}>{value}</div>
    </div>
  );
}
