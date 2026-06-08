import { useState, useEffect, useMemo, useRef } from "react";
import { simApi } from "../api";
import { Card } from "../components/Card";
import { Kpi } from "../components/Kpi";
import { Tag } from "../components/Tag";
import { Sparkline } from "../components/charts/Sparkline";
import { Tabs } from "../components/Tabs";
import { fmtMoney, fmtPct, fmtSigned, fmtDir, dirColor } from "../utils";
import type { SimAccount, SimPosition } from "../types";

const CACHE_KEY = "holdings_cache";

interface HoldingsCache {
  account: SimAccount;
  positions: SimPosition[];
}

function readCache(): HoldingsCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as HoldingsCache : null;
  } catch { return null; }
}

function writeCache(account: SimAccount, positions: SimPosition[]) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ account, positions })); } catch {}
}

const EMPTY_ACCOUNT: SimAccount = {
  id: 0, name: "", initialBalance: 1000000, cashBalance: 0, totalAssets: 0,
  marketValue: 0, todayPnl: 0, todayPnlPct: 0, totalPnl: 0, totalPnlPct: 0,
  positionCount: 0, orderCount: 0, createdAt: "",
};

export function HoldingsPage() {
  const cached = useRef(readCache());
  const [account, setAccount] = useState<SimAccount>(cached.current?.account ?? EMPTY_ACCOUNT);
  const [positions, setPositions] = useState<SimPosition[]>(cached.current?.positions ?? []);
  const [loaded, setLoaded] = useState(!!cached.current);
  const [sortKey, setSortKey] = useState<"marketValue" | "pnl" | "todayPnl" | "weight">("marketValue");

  useEffect(() => {
    Promise.all([
      simApi.getAccount().catch(() => null),
      simApi.getPositions().catch(() => [] as SimPosition[]),
    ]).then(([acc, pos]) => {
      if (acc) {
        setAccount(acc);
        setPositions(pos);
        writeCache(acc, pos);
      }
      setLoaded(true);
    });
  }, []);

  const sorted = useMemo(() =>
    [...positions].sort((a, b) => Math.abs(b[sortKey]) - Math.abs(a[sortKey]))
  , [positions, sortKey]);

  const showSkeleton = !loaded && !cached.current;

  const totalMV = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.costValue, 0);
  const totalPL = positions.reduce((s, p) => s + p.pnl, 0);
  const totalPLPct = totalCost > 0 ? totalPL / totalCost : 0;

  const sectorMap = useMemo(() => {
    const map = new Map<string, { value: number; count: number }>();
    for (const p of positions) {
      const key = p.sector || "未分类";
      const cur = map.get(key) ?? { value: 0, count: 0 };
      cur.value += p.marketValue;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([sector, { value, count }]) => ({ sector, value, count, pct: totalMV > 0 ? value / totalMV : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [positions, totalMV]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="持仓市值" /> : (
            <Kpi label="持仓市值" value={fmtMoney(totalMV)} sub={`${positions.length} 只`} />
          )}
        </Card>
        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="持仓成本" /> : (
            <Kpi label="持仓成本" value={fmtMoney(totalCost)} />
          )}
        </Card>
        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="浮动盈亏" /> : (
            <Kpi label="浮动盈亏" mono value={fmtSigned(totalPL)}
              accent={totalPL > 0 ? "var(--sim-up)" : totalPL < 0 ? "var(--sim-down)" : undefined}
              delta={fmtPct(totalPLPct)} deltaPct={totalPLPct} />
          )}
        </Card>
        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="今日盈亏" /> : (
            account.todayPnl == null ? (
              <Kpi label="今日盈亏" value="—" sub="集合竞价中" />
            ) : (
              <Kpi label="今日盈亏" mono value={fmtSigned(account.todayPnl!)}
                accent={account.todayPnl! > 0 ? "var(--sim-up)" : account.todayPnl! < 0 ? "var(--sim-down)" : undefined}
                delta={fmtPct(account.todayPnlPct ?? 0)} deltaPct={account.todayPnlPct ?? 0} />
            )
          )}
        </Card>
        <Card padded={false} style={{ padding: "18px 20px" }}>
          {showSkeleton ? <KpiSkeleton label="仓位 / 现金" /> : (
            <Kpi label="仓位 / 现金" value={`${account.totalAssets > 0 ? (totalMV / account.totalAssets * 100).toFixed(1) : "0.0"}%`}
              sub={`现金 ${fmtMoney(account.cashBalance)}`} />
          )}
        </Card>
      </div>

      {/* Main: table + sidebar */}
      <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Position Table */}
        <Card title="持仓明细" subtitle={`${positions.length} 只`}
          action={
            <Tabs size="sm" value={sortKey} onChange={v => setSortKey(v as typeof sortKey)}
              tabs={[
                { value: "marketValue", label: "按市值" },
                { value: "pnl", label: "按盈亏" },
                { value: "todayPnl", label: "按今日" },
                { value: "weight", label: "按占比" },
              ]}
            />
          }
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--sim-text-mute)", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <th style={th}>标的</th>
                  <th style={{ ...th, textAlign: "right" }}>现价</th>
                  <th style={{ ...th, textAlign: "right" }}>涨跌</th>
                  <th style={th}>走势</th>
                  <th style={{ ...th, textAlign: "right" }}>持仓</th>
                  <th style={{ ...th, textAlign: "right" }}>成本</th>
                  <th style={{ ...th, textAlign: "right" }}>市值</th>
                  <th style={{ ...th, textAlign: "right" }}>盈亏</th>
                  <th style={{ ...th, textAlign: "right" }}>今日</th>
                  <th style={{ ...th, textAlign: "right" }}>占比</th>
                </tr>
              </thead>
              <tbody>
                {showSkeleton ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--sim-hairline)" }}>
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} style={td}><Shimmer w={j === 0 ? 70 : 50} h={14} /></td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <>
                    {sorted.map(p => {
                      const dir = fmtDir(p.pnl);
                      const todayDir = fmtDir(p.todayPnl);
                      return (
                        <tr key={p.id} style={{ borderTop: "1px solid var(--sim-hairline)" }}>
                          <td style={td}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontWeight: 500 }}>{p.name}</span>
                                {p.sector && <Tag kind="ghost" size="sm">{p.sector}</Tag>}
                              </div>
                              <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)" }}>{p.ticker}</span>
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: "right", fontFamily: "var(--sim-mono)", fontWeight: 600 }}>{p.currentPrice.toFixed(2)}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <span style={{ fontFamily: "var(--sim-mono)", color: dirColor(todayDir), fontWeight: 500 }}>
                              {fmtPct(p.todayPnlPct)}
                            </span>
                          </td>
                          <td style={td}>
                            <Sparkline data={[p.prevClose, p.currentPrice]} width={60} height={24} prevClose={p.prevClose} />
                          </td>
                          <td style={{ ...td, textAlign: "right", fontFamily: "var(--sim-mono)" }}>{p.quantity.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: "right", fontFamily: "var(--sim-mono)", color: "var(--sim-text-soft)" }}>{p.avgCost.toFixed(2)}</td>
                          <td style={{ ...td, textAlign: "right", fontFamily: "var(--sim-mono)", fontWeight: 600 }}>{fmtMoney(p.marketValue)}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                              <span style={{ fontFamily: "var(--sim-mono)", fontWeight: 600, color: dirColor(dir) }}>{fmtSigned(p.pnl)}</span>
                              <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: dirColor(dir) }}>{fmtPct(p.pnlPct)}</span>
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <span style={{ fontFamily: "var(--sim-mono)", color: account.todayPnl == null ? "var(--sim-text-mute)" : dirColor(todayDir) }}>
                              {account.todayPnl == null ? "—" : fmtSigned(p.todayPnl)}
                            </span>
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <Tag kind="ghost" size="sm">{(p.weight * 100).toFixed(1)}%</Tag>
                          </td>
                        </tr>
                      );
                    })}
                    {positions.length === 0 && (
                      <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "var(--sim-text-mute)", padding: 40 }}>暂无持仓</td></tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectorConcentration sectors={sectorMap} />
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "12px 8px", fontWeight: 500, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "14px 8px", verticalAlign: "middle", whiteSpace: "nowrap" };

const SECTOR_COLORS = [
  "#1B2559", "#C2410C", "#1F8A5B", "#9A6700", "#5A554D",
  "#7C5CBF", "#2A7B9B", "#D7263D", "#5A8A3D", "#9B6B3A",
];

function SectorConcentration({ sectors }: { sectors: Array<{ sector: string; value: number; count: number; pct: number }> }) {
  return (
    <Card title="行业集中度" subtitle="单一行业占比上限 35%">
      {sectors.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--sim-text-mute)", fontSize: 13 }}>暂无持仓</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          {sectors.map((s, i) => {
            const color = SECTOR_COLORS[i % SECTOR_COLORS.length]!;
            const pctVal = s.pct * 100;
            return (
              <div key={s.sector}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span>{s.sector}</span>
                  </div>
                  <span style={{ fontFamily: "var(--sim-mono)", color: "var(--sim-text-soft)" }}>
                    <span style={{ fontWeight: 600, color: "var(--sim-text)" }}>{pctVal.toFixed(1)}%</span>
                    <span style={{ marginLeft: 6, color: "var(--sim-text-mute)" }}>{fmtMoney(s.value)}</span>
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--sim-bg-soft)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${pctVal / ((sectors[0]?.pct ?? s.pct) * 100) * 100}%`,
                    background: color,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Shimmer({ w, h }: { w: number | string; h: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 6,
      background: "linear-gradient(90deg, var(--sim-bg-soft) 25%, var(--sim-surface-2) 50%, var(--sim-bg-soft) 75%)",
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
