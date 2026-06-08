import { useState, useEffect } from "react";
import { PulseDot } from "./PulseDot";

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="0" y="0" width="22" height="22" rx="5" fill="var(--sim-brand)" />
        <path d="M4 14 L8 9 L12 12 L18 5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="5" r="1.6" fill="var(--sim-accent)" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>LingTrade</span>
        <span style={{ fontSize: 10, color: "var(--sim-text-mute)", marginTop: 2, letterSpacing: "0.04em" }}>AGENT QUANT</span>
      </div>
    </div>
  );
}

function getMarketStatus(now: Date): { state: "open" | "lunch" | "closed" | "auction" | "pre"; label: string } {
  const day = now.getDay();
  if (day === 0 || day === 6) return { state: "closed", label: "休市" };
  const t = now.getHours() * 60 + now.getMinutes();
  if (t >= 555 && t < 565) return { state: "auction", label: "集合竞价" };
  if (t >= 897 && t < 900) return { state: "auction", label: "集合竞价" };
  if (t >= 565 && t < 570) return { state: "pre", label: "盘前" };
  if ((t >= 570 && t <= 690) || (t >= 780 && t < 897)) return { state: "open", label: "交易中" };
  if (t > 690 && t < 780) return { state: "lunch", label: "午休" };
  if (t >= 900) return { state: "closed", label: "盘后" };
  return { state: "closed", label: "盘后" };
}

function MarketClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const status = getMarketStatus(now);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateStr = now.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" });

  const isOpen = status.state === "open";
  const isLunch = status.state === "lunch";
  const isTransition = status.state === "auction" || status.state === "pre";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "6px 12px",
      background: isOpen ? "#FCFBF8" : isLunch || isTransition ? "#FFF6E0" : "#F2F0EB",
      border: `1px solid ${isOpen ? "var(--sim-border)" : isLunch || isTransition ? "#F0DDA1" : "var(--sim-border-strong)"}`,
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isOpen && <PulseDot color="var(--sim-up)" />}
        {(isLunch || isTransition) && <span style={{ width: 8, height: 8, background: "#9A6700", borderRadius: "50%" }} />}
        {!isOpen && !isLunch && !isTransition && <span style={{ width: 8, height: 8, background: "var(--sim-text-faint)", borderRadius: "50%" }} />}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{status.label}</span>
      </div>
      <div style={{ height: 14, width: 1, background: "var(--sim-border-strong)" }} />
      <div style={{ fontFamily: "var(--sim-mono)", fontSize: 12.5, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>
        {dateStr} <span style={{ color: "var(--sim-text-mute)", margin: "0 4px" }}>·</span>
        <span>{hh}:{mm}:<span style={{ color: "var(--sim-text-soft)" }}>{ss}</span></span>
      </div>
    </div>
  );
}

const PAGES = [
  { id: "dashboard", label: "总览" },
  { id: "market", label: "行情" },
  { id: "holdings", label: "持仓" },
  { id: "trades", label: "交易明细" },
  { id: "agent", label: "Agent 决策" },
  { id: "research", label: "投研报告" },
  { id: "knowledge", label: "知识库" },
];

interface TopNavProps {
  page: string;
  setPage: (page: string) => void;
  schedulerRunning?: boolean;
  onToggleScheduler?: () => void;
  onOpenGuide?: () => void;
}

export function TopNav({ page, setPage, schedulerRunning, onToggleScheduler, onOpenGuide }: TopNavProps) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 100,
      background: "rgba(247,247,245,0.80)",
      backdropFilter: "saturate(180%) blur(12px)",
      WebkitBackdropFilter: "saturate(180%) blur(12px)",
      borderBottom: "1px solid var(--sim-border)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 24,
        padding: "12px 28px", maxWidth: 1640, margin: "0 auto",
      }}>
        <Logo />
        <nav style={{ display: "flex", gap: 2, marginLeft: 12 }}>
          {PAGES.map(p => {
            const active = p.id === page;
            return (
              <button key={p.id} onClick={() => setPage(p.id)}
                style={{
                  border: "none", background: "transparent",
                  padding: "8px 14px", fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--sim-text)" : "var(--sim-text-soft)",
                  borderRadius: 8, cursor: "pointer",
                  position: "relative",
                  fontFamily: "var(--sim-sans)",
                }}>
                {p.label}
                {active && <span style={{
                  position: "absolute", left: 14, right: 14, bottom: -13,
                  height: 2, background: "var(--sim-brand)", borderRadius: 2,
                }} />}
              </button>
            );
          })}
        </nav>
        <div style={{ flex: 1 }} />
        <MarketClock />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onToggleScheduler} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 12px",
            background: "var(--sim-surface)", border: "1px solid var(--sim-border)", borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            <PulseDot color={schedulerRunning ? "var(--sim-down)" : "var(--sim-text-faint)"} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>
              Agent · {schedulerRunning ? "运行中" : "已停止"}
            </span>
          </button>
          <button onClick={onOpenGuide} title="新手向导"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "1px solid var(--sim-border)",
              background: "var(--sim-surface)",
              color: "var(--sim-text-soft)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
          <button onClick={() => setPage("settings")} title="设置"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "1px solid " + (page === "settings" ? "var(--sim-brand)" : "var(--sim-border)"),
              background: page === "settings" ? "var(--sim-bg-soft)" : "var(--sim-surface)",
              color: page === "settings" ? "var(--sim-brand)" : "var(--sim-text-soft)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
