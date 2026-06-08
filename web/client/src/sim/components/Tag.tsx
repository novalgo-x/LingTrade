import type { CSSProperties, ReactNode } from "react";

type TagKind = "neutral" | "brand" | "up" | "down" | "warn" | "accent" | "ghost";

const PALETTES: Record<TagKind, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: "#F2F0EB", fg: "#5A554D", bd: "#E5E3DE" },
  brand:   { bg: "#EEF0FA", fg: "var(--sim-brand)", bd: "#D8DCEF" },
  up:      { bg: "var(--sim-up-soft)", fg: "var(--sim-up)", bd: "#F5C7CE" },
  down:    { bg: "var(--sim-down-soft)", fg: "var(--sim-down)", bd: "#C7E3D4" },
  warn:    { bg: "#FFF6E0", fg: "#9A6700", bd: "#F0DDA1" },
  accent:  { bg: "var(--sim-accent-soft)", fg: "var(--sim-accent)", bd: "#F2CFA8" },
  ghost:   { bg: "transparent", fg: "var(--sim-text-soft)", bd: "var(--sim-border)" },
};

interface TagProps {
  kind?: TagKind;
  size?: "sm" | "md";
  children: ReactNode;
  style?: CSSProperties;
}

export function Tag({ kind = "neutral", size = "md", children, style }: TagProps) {
  const p = PALETTES[kind];
  const padY = size === "sm" ? 1 : 2;
  const padX = size === "sm" ? 6 : 8;
  const fs = size === "sm" ? 10.5 : 11.5;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: `${padY}px ${padX}px`,
      background: p.bg, color: p.fg, border: `1px solid ${p.bd}`,
      borderRadius: 999, fontSize: fs, fontWeight: 600, letterSpacing: "0.02em",
      lineHeight: 1.4, ...style,
    }}>{children}</span>
  );
}

type ActionKind = "buy" | "sell" | "hold";

const ACTION_PALETTES: Record<ActionKind, { bg: string; fg: string; bd: string }> = {
  buy:  { bg: "var(--sim-up-soft)", fg: "var(--sim-up)", bd: "#F5C7CE" },
  sell: { bg: "var(--sim-down-soft)", fg: "var(--sim-down)", bd: "#C7E3D4" },
  hold: { bg: "#F2F0EB", fg: "#5A554D", bd: "#E5E3DE" },
};

interface ActionTagProps {
  action: ActionKind;
  size?: "sm" | "md";
}

export function ActionTag({ action, size = "md" }: ActionTagProps) {
  const p = ACTION_PALETTES[action] ?? ACTION_PALETTES.hold;
  const padY = size === "sm" ? 1 : 3;
  const padX = size === "sm" ? 6 : 8;
  const label = action === "buy" ? "BUY" : action === "sell" ? "SELL" : "HOLD";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: `${padY}px ${padX}px`,
      background: p.bg, color: p.fg, border: `1px solid ${p.bd}`,
      borderRadius: 4, fontSize: size === "sm" ? 10.5 : 11, fontWeight: 700,
      letterSpacing: "0.06em", fontFamily: "var(--sim-mono)",
    }}>{label}</span>
  );
}
