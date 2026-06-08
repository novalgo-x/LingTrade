import type { CSSProperties, ReactNode } from "react";

type BtnKind = "primary" | "ghost" | "soft" | "danger";

const PALETTES: Record<BtnKind, { bg: string; fg: string; bd: string }> = {
  primary: { bg: "var(--sim-brand)", fg: "#fff", bd: "var(--sim-brand)" },
  ghost:   { bg: "var(--sim-surface)", fg: "var(--sim-text)", bd: "var(--sim-border-strong)" },
  soft:    { bg: "var(--sim-bg-soft)", fg: "var(--sim-text)", bd: "var(--sim-border)" },
  danger:  { bg: "var(--sim-up)", fg: "#fff", bd: "var(--sim-up)" },
};

interface BtnProps {
  children?: ReactNode;
  kind?: BtnKind;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Btn({ children, kind = "ghost", size = "md", icon, onClick, disabled, style }: BtnProps) {
  const p = PALETTES[kind];
  const pad = size === "sm" ? "4px 10px" : size === "lg" ? "10px 18px" : "6px 14px";
  const fs = size === "sm" ? 12 : size === "lg" ? 14 : 13;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: pad, fontSize: fs, fontWeight: 500,
        background: p.bg, color: p.fg,
        border: `1px solid ${p.bd}`, borderRadius: 8,
        opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.12s ease", ...style,
      }}>
      {icon && <span style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </button>
  );
}
