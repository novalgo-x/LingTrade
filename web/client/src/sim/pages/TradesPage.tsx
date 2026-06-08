import { useState, useEffect, useMemo } from "react";
import { simApi } from "../api";
import { Card } from "../components/Card";
import { Kpi } from "../components/Kpi";
import { Tag } from "../components/Tag";
import { Tabs } from "../components/Tabs";
import { fmtMoney, fmtDate } from "../utils";
import type { SimOrder } from "../types";

export function TradesPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [orders, setOrders] = useState<SimOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const params: Record<string, string> = {};
    if (filter === "buy") params.side = "buy";
    if (filter === "sell") params.side = "sell";
    if (filter === "rejected") params.status = "rejected";
    simApi.getOrders({ limit: 200, ...params }).then(r => { setOrders(r.data); setTotal(r.total); }).catch(() => {});
  }, [filter]);

  const stats = useMemo(() => {
    const filled = orders.filter(o => o.status === "filled");
    const buys = filled.filter(o => o.side === "buy");
    const sells = filled.filter(o => o.side === "sell");
    return {
      total: orders.length,
      filled: filled.length,
      rejected: orders.filter(o => o.status === "rejected").length,
      buyAmt: buys.reduce((s, o) => s + o.amount, 0),
      sellAmt: sells.reduce((s, o) => s + o.amount, 0),
      fee: orders.reduce((s, o) => s + o.fee, 0),
    };
  }, [orders]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        <Card padded={false} style={{ padding: "16px 18px" }}>
          <Kpi label="成交笔数" mono={false} value={`${stats.filled}`} sub={`${stats.rejected} 拒绝`} />
        </Card>
        <Card padded={false} style={{ padding: "16px 18px" }}>
          <Kpi label="买入金额" value={fmtMoney(stats.buyAmt)} accent="var(--sim-up)" />
        </Card>
        <Card padded={false} style={{ padding: "16px 18px" }}>
          <Kpi label="卖出金额" value={fmtMoney(stats.sellAmt)} accent="var(--sim-down)" />
        </Card>
        <Card padded={false} style={{ padding: "16px 18px" }}>
          <Kpi label="净流出" value={fmtMoney(stats.sellAmt - stats.buyAmt)} mono />
        </Card>
        <Card padded={false} style={{ padding: "16px 18px" }}>
          <Kpi label="手续费" value={fmtMoney(stats.fee, 2)} mono />
        </Card>
        <Card padded={false} style={{ padding: "16px 18px" }}>
          <Kpi label="总记录" mono={false} value={`${total}`} />
        </Card>
      </div>

      <Card padded={false}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--sim-hairline)", gap: 16, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>交易流水</div>
            <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>
              共 {orders.length} 条记录
            </div>
          </div>
          <Tabs value={filter} onChange={setFilter}
            tabs={[
              { value: "all", label: "全部" },
              { value: "buy", label: "买入" },
              { value: "sell", label: "卖出" },
              { value: "rejected", label: "拒绝" },
            ]}
            size="sm"
          />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--sim-text-mute)", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <th style={tth}>成交时间</th>
                <th style={tth}>方向</th>
                <th style={tth}>标的</th>
                <th style={{ ...tth, textAlign: "right" }}>数量</th>
                <th style={{ ...tth, textAlign: "right" }}>成交价</th>
                <th style={{ ...tth, textAlign: "right" }}>成交金额</th>
                <th style={{ ...tth, textAlign: "right" }}>手续费</th>
                <th style={tth}>状态</th>
                <th style={tth}>关联决策</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(t => (
                <tr key={t.id} style={{ borderTop: "1px solid var(--sim-hairline)" }}>
                  <td style={{ ...ttd, fontFamily: "var(--sim-mono)", color: "var(--sim-text-soft)" }}>
                    {fmtDate(t.createdAt)}
                  </td>
                  <td style={ttd}>
                    <span style={{
                      fontFamily: "var(--sim-mono)", fontSize: 11, fontWeight: 700,
                      padding: "3px 8px", borderRadius: 4, letterSpacing: "0.05em",
                      background: t.side === "buy" ? "var(--sim-up-soft)" : "var(--sim-down-soft)",
                      color: t.side === "buy" ? "var(--sim-up)" : "var(--sim-down)",
                      border: `1px solid ${t.side === "buy" ? "#F5C7CE" : "#C7E3D4"}`,
                    }}>{t.side === "buy" ? "买入" : "卖出"}</span>
                  </td>
                  <td style={ttd}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 500 }}>{t.name}</span>
                      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)", marginTop: 1 }}>{t.ticker}</span>
                    </div>
                  </td>
                  <td style={{ ...ttd, textAlign: "right", fontFamily: "var(--sim-mono)" }}>
                    {t.quantity > 0 ? t.quantity.toLocaleString() : "—"}
                  </td>
                  <td style={{ ...ttd, textAlign: "right", fontFamily: "var(--sim-mono)" }}>
                    {t.price > 0 ? t.price.toFixed(2) : "—"}
                  </td>
                  <td style={{ ...ttd, textAlign: "right", fontFamily: "var(--sim-mono)", fontWeight: 600 }}>
                    {t.amount > 0 ? fmtMoney(t.amount, 2) : "—"}
                  </td>
                  <td style={{ ...ttd, textAlign: "right", fontFamily: "var(--sim-mono)", color: "var(--sim-text-mute)" }}>
                    {t.fee > 0 ? "¥" + t.fee.toFixed(2) : "—"}
                  </td>
                  <td style={ttd}>
                    {t.status === "filled" && <Tag kind="down" size="sm">已成交</Tag>}
                    {t.status === "rejected" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <Tag kind="up" size="sm">已拒绝</Tag>
                        {t.rejectReason && <span style={{ fontSize: 10.5, color: "var(--sim-text-mute)" }}>{t.rejectReason}</span>}
                      </div>
                    )}
                  </td>
                  <td style={ttd}>
                    {t.decisionId ? (
                      <span
                        onClick={() => onNavigate(`agent:${t.decisionId}`)}
                        style={{ fontFamily: "var(--sim-mono)", fontSize: 12, color: "var(--sim-brand)", borderBottom: "1px dashed var(--sim-brand)", cursor: "pointer" }}
                      >
                        DEC-{t.decisionId}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={9} style={{ ...ttd, textAlign: "center", color: "var(--sim-text-mute)", padding: 40 }}>暂无交易记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const tth: React.CSSProperties = { textAlign: "left", padding: "12px 14px", fontWeight: 500, whiteSpace: "nowrap" };
const ttd: React.CSSProperties = { padding: "14px 14px", verticalAlign: "middle", whiteSpace: "nowrap" };
