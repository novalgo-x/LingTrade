import { useState, useEffect, useRef } from "react";
import { simApi } from "../api";
import { Card } from "../components/Card";
import { Kpi } from "../components/Kpi";
import { Tag, ActionTag } from "../components/Tag";
import { Tabs } from "../components/Tabs";
import { Btn } from "../components/Btn";
import { EquityCurve } from "../components/charts/EquityCurve";
import { Donut } from "../components/charts/Donut";
import { MiniBar } from "../components/charts/MiniBar";
import { fmtMoney, fmtPct, fmtPctRaw, fmtSigned, fmtDate } from "../utils";
import type { SimAccount, SimPosition, SimDecision, IndexQuote, DashReportSummary } from "../types";

const PALETTE = ["#1B2559", "#C2410C", "#1F8A5B", "#9A6700", "#5A554D", "#2D3A77"];
const CACHE_KEY = "dashboard_cache";

interface DashboardCache {
  account: SimAccount;
  positions: SimPosition[];
  decisions: SimDecision[];
  ts: number;
}

function readCache(): DashboardCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardCache;
  } catch { return null; }
}

function writeCache(account: SimAccount, positions: SimPosition[], decisions: SimDecision[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ account, positions, decisions, ts: Date.now() }));
  } catch {}
}

const EMPTY_ACCOUNT: SimAccount = {
  id: 0, name: "", initialBalance: 1000000, cashBalance: 0, totalAssets: 0,
  marketValue: 0, todayPnl: 0, todayPnlPct: 0, totalPnl: 0, totalPnlPct: 0,
  positionCount: 0, orderCount: 0, createdAt: "",
};

export function Dashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const cached = useRef(readCache());
  const [account, setAccount] = useState<SimAccount>(cached.current?.account ?? EMPTY_ACCOUNT);
  const [positions, setPositions] = useState<SimPosition[]>(cached.current?.positions ?? []);
  const [decisions, setDecisions] = useState<SimDecision[]>(cached.current?.decisions ?? []);
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [latestReports, setLatestReports] = useState<DashReportSummary[]>([]);
  const [navHistory, setNavHistory] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(!!cached.current);

  useEffect(() => {
    const todayUtc8 = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    Promise.all([
      simApi.getAccount().catch(() => null),
      simApi.getPositions().catch(() => [] as SimPosition[]),
      simApi.getDecisions({ limit: 50, date: todayUtc8 }).catch(() => ({ data: [] as SimDecision[] })),
      simApi.getIndices().catch(() => [] as IndexQuote[]),
      simApi.getLatestReports().catch(() => [] as DashReportSummary[]),
      simApi.getNavHistory().catch(() => [] as { date: string; nav: number }[]),
    ]).then(([acc, pos, dec, idx, rpts, nav]) => {
      if (acc) {
        setAccount(acc);
        setPositions(pos);
        setDecisions(dec.data);
        writeCache(acc, pos, dec.data);
      }
      setIndices(idx);
      setLatestReports(rpts);
      if (nav.length > 0) setNavHistory(nav.map(n => n.nav));
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      simApi.getIndices().then(setIndices).catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const positionValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const positionPct = account.totalAssets > 0 ? (positionValue / account.totalAssets * 100).toFixed(1) : "0.0";

  const allocData = [
    ...positions.sort((a, b) => b.marketValue - a.marketValue).map((h, i) => ({
      label: h.name, value: h.marketValue, color: PALETTE[i % PALETTE.length]!,
    })),
    { label: "现金", value: account.cashBalance, color: "#E5E3DE" },
  ];

  const equityData = navHistory.length > 0 ? navHistory : [account.initialBalance, account.totalAssets];

  const showSkeleton = !loaded && !cached.current;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        <Card padded={false} style={{ padding: "18px 20px", background: "var(--sim-brand)", color: "#fff", border: "none", gridColumn: "span 2" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11.5, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.7 }}>账户总资产</div>
              <div style={{ fontFamily: "var(--sim-mono)", fontSize: 34, fontWeight: 600, marginTop: 6, letterSpacing: "-0.01em" }}>
                {showSkeleton ? <Shimmer w={180} h={34} light /> : fmtMoney(account.totalAssets)}
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 12.5 }}>
                <span style={{ opacity: 0.7 }}>累计收益</span>
                <span style={{ fontFamily: "var(--sim-mono)", fontWeight: 600 }}>
                  {showSkeleton ? <Shimmer w={100} h={14} light /> : (
                    <>{fmtSigned(account.totalPnl)} <span style={{ opacity: 0.7 }}>({fmtPct(account.totalPnlPct)})</span></>
                  )}
                </span>
              </div>
            </div>
          </div>
        </Card>

        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="今日 P&L" /> : (
            account.todayPnl == null ? (
              <Kpi label="今日 P&L" value="—" sub="集合竞价中" />
            ) : (
              <Kpi label="今日 P&L" mono
                value={fmtSigned(account.todayPnl)}
                accent={account.todayPnl > 0 ? "var(--sim-up)" : account.todayPnl < 0 ? "var(--sim-down)" : undefined}
                sub="vs 昨收"
              />
            )
          )}
        </Card>

        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="可用现金" /> : (
            <Kpi label="可用现金" mono value={fmtMoney(account.cashBalance, 0)} />
          )}
        </Card>

        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="持仓市值" /> : (
            <Kpi label="持仓市值" mono
              value={fmtMoney(positionValue, 0)}
              sub={`仓位 ${positionPct}%`}
            />
          )}
        </Card>

        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="持仓数" /> : (
            <Kpi label="持仓数" mono
              value={String(account.positionCount)}
              sub={`${account.orderCount ?? 0} 笔交易`}
            />
          )}
        </Card>
      </div>

      {/* Row 2: Equity curve + Allocation */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16 }}>
        <Card title="账户净值曲线" subtitle={`起始资金 ${fmtMoney(account.initialBalance, 0)}`}
          action={
            <Tabs value="all" onChange={() => {}} tabs={[
              { value: "1w", label: "1周" }, { value: "1m", label: "1月" },
              { value: "3m", label: "3月" }, { value: "all", label: "全部" },
            ]} size="sm" />
          }
        >
          <div style={{ marginTop: 8 }}>
            {showSkeleton ? <Shimmer w="100%" h={220} /> : (
              <EquityCurve data={equityData} baseline={account.initialBalance} height={220} />
            )}
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--sim-hairline)" }}>
            {showSkeleton ? (
              <><Shimmer w={100} h={32} /><Shimmer w={100} h={32} /></>
            ) : (
              <>
                <StatItem label="累计收益率" value={fmtPct(account.totalPnlPct)} dir={account.totalPnlPct} />
                <StatItem label="今日收益率" value={account.todayPnlPct != null ? fmtPct(account.todayPnlPct) : "—"} dir={account.todayPnlPct ?? 0} />
              </>
            )}
          </div>
        </Card>

        <Card title="资产配置" subtitle={`${positions.length} 只持仓 + 现金`}>
          {showSkeleton ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 150 }}>
              <Shimmer w={150} h={150} round />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 4 }}>
              <div style={{ position: "relative" }}>
                <Donut data={allocData} size={150} thickness={20} />
                <div style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: 10, color: "var(--sim-text-mute)", letterSpacing: "0.04em" }}>权益占比</span>
                  <span style={{ fontFamily: "var(--sim-mono)", fontSize: 17, fontWeight: 600 }}>{positionPct}%</span>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                {allocData.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: "var(--sim-text-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
                    <span style={{ fontFamily: "var(--sim-mono)", color: "var(--sim-text)", fontWeight: 500 }}>
                      {account.totalAssets > 0 ? (d.value / account.totalAssets * 100).toFixed(1) : "0.0"}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Row 3: Today's decisions + Indices + Latest reports */}
      <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr", gap: 16 }}>
        <Card title="今日决策" subtitle={`${decisions.filter(d => d.status === "executed").length} 笔已执行`}
          action={<Btn size="sm" kind="primary" onClick={() => onNavigate("agent")}>查看决策中心</Btn>}
        >
          <div style={{ marginTop: 4, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--sim-text-mute)", fontSize: 10.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <th style={th}>时间</th>
                  <th style={th}>决策 ID</th>
                  <th style={th}>标的</th>
                  <th style={th}>动作</th>
                  <th style={{ ...th, textAlign: "right" }}>金额</th>
                  <th style={th}>置信度</th>
                  <th style={{ ...th, textAlign: "right" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {showSkeleton ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--sim-hairline)" }}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} style={dtd}><Shimmer w={j === 2 ? 70 : 40} h={13} /></td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <>
                    {decisions.filter(d => d.action !== "hold").slice(0, 6).map(d => (
                      <tr key={d.id}
                        onClick={() => onNavigate(`agent:${d.id}`)}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--sim-surface-2)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        style={{ borderTop: "1px solid var(--sim-hairline)", cursor: "pointer" }}
                      >
                        <td style={{ ...dtd, fontFamily: "var(--sim-mono)", color: "var(--sim-text-soft)" }}>
                          {fmtDate(d.createdAt).split(" ")[1] ?? ""}
                        </td>
                        <td style={{ ...dtd, fontFamily: "var(--sim-mono)", color: "var(--sim-brand)", fontWeight: 500 }}>
                          #{d.id}
                        </td>
                        <td style={dtd}>
                          <span style={{ fontWeight: 500 }}>{d.name ?? d.ticker}</span>
                        </td>
                        <td style={dtd}><ActionTag action={d.action} size="sm" /></td>
                        <td style={{ ...dtd, textAlign: "right", fontFamily: "var(--sim-mono)", fontWeight: 500 }}>
                          {d.quantity > 0 && d.price ? fmtMoney(d.quantity * d.price, 0) : "—"}
                        </td>
                        <td style={dtd}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, width: 135 }}>
                            <MiniBar value={d.confidence} max={1}
                              color={d.confidence > 0.7 ? "var(--sim-down)" : d.confidence > 0.5 ? "var(--sim-accent)" : "var(--sim-flat)"} />
                            <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-soft)", flexShrink: 0 }}>{(d.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td style={{ ...dtd, textAlign: "right" }}>
                          <Tag kind={d.status === "executed" ? "down" : d.status === "rejected" ? "up" : "neutral"} size="sm">
                            {d.status === "executed" ? "已执行" : d.status === "rejected" ? "已拒绝" : "已评估"}
                          </Tag>
                        </td>
                      </tr>
                    ))}
                    {decisions.filter(d => d.action !== "hold").length === 0 && (
                      <tr><td colSpan={7} style={{ ...dtd, textAlign: "center", color: "var(--sim-text-mute)" }}>暂无决策记录</td></tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="主要指数" subtitle="A 股盘面">
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {showSkeleton ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--sim-hairline)" : "none" }}>
                  <Shimmer w={80} h={14} /><Shimmer w={60} h={14} />
                </div>
              ))
            ) : indices.length === 0 ? (
              <div style={{ padding: "24px 0", textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>暂无数据</div>
            ) : (
              indices.map((idx, i) => (
                <div key={idx.code} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0", borderBottom: i < indices.length - 1 ? "1px solid var(--sim-hairline)" : "none",
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{idx.name}</div>
                    <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", marginTop: 1 }}>{idx.code}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--sim-mono)", fontWeight: 600, fontSize: 14, color: idx.chgPct > 0 ? "var(--sim-up)" : idx.chgPct < 0 ? "var(--sim-down)" : "var(--sim-text)" }}>
                      {idx.value.toFixed(2)}
                    </div>
                    <div style={{ fontFamily: "var(--sim-mono)", fontSize: 11, marginTop: 1, color: idx.chgPct > 0 ? "var(--sim-up)" : idx.chgPct < 0 ? "var(--sim-down)" : "var(--sim-text-mute)" }}>
                      {fmtSigned(idx.chg)} {fmtPctRaw(idx.chgPct)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="最新投研报告" subtitle="决策核心输入源">
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {showSkeleton ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--sim-hairline)" : "none" }}>
                  <Shimmer w="100%" h={14} />
                </div>
              ))
            ) : latestReports.length === 0 ? (
              <div style={{ padding: "24px 0", textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>暂无报告</div>
            ) : (
              latestReports.slice(0, 5).map((r, i, arr) => (
                <div key={r.id}
                  onClick={() => onNavigate(`research:${r.id}`)}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--sim-surface-2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 4px",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--sim-hairline)" : "none",
                    cursor: "pointer", borderRadius: 4,
                  }}
                >
                  <ActionTag action={r.action as "buy" | "sell" | "hold"} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                      {r.stock_name ?? "未知"}
                      <span style={{ color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", fontWeight: 400, marginLeft: 6 }}>{r.stock_ticker ?? ""}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginTop: 2, fontFamily: "var(--sim-mono)" }}>
                      目标 ¥{r.target_price?.toFixed(2) ?? "—"} · 置信 {(r.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", textAlign: "right", flexShrink: 0 }}>
                    {fmtDate(r.created_at).split(" ")[1]?.slice(0, 5) ?? ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 6px", fontWeight: 500 };
const dtd: React.CSSProperties = { padding: "9px 6px", verticalAlign: "middle", whiteSpace: "nowrap" };

function StatItem({ label, value, dir }: { label: string; value: string; dir: number }) {
  const color = dir > 0 ? "var(--sim-up)" : dir < 0 ? "var(--sim-down)" : "var(--sim-text-mute)";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 600, marginTop: 2, fontFamily: "var(--sim-mono)", color }}>{value}</span>
    </div>
  );
}

function Shimmer({ w, h, light, round }: { w: number | string; h: number; light?: boolean; round?: boolean }) {
  return (
    <div style={{
      width: w, height: h,
      borderRadius: round ? "50%" : 6,
      background: light
        ? "linear-gradient(90deg, rgba(255,255,255,0.12) 25%, rgba(255,255,255,0.24) 50%, rgba(255,255,255,0.12) 75%)"
        : "linear-gradient(90deg, var(--sim-bg-soft) 25%, var(--sim-surface-2) 50%, var(--sim-bg-soft) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s ease-in-out infinite",
    }} />
  );
}

function KpiSkeleton({ label }: { label: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--sim-text-mute)", letterSpacing: "0.04em", marginBottom: 8 }}>{label}</div>
      <Shimmer w={90} h={22} />
    </div>
  );
}
