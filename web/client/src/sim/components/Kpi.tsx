import type { ReactNode } from "react";

interface KpiProps {
  label: string;
  value: string | ReactNode;
  sub?: string;
  delta?: string;
  deltaPct?: number;
  mono?: boolean;
  size?: "sm" | "md" | "lg";
  accent?: string;
}

export function Kpi({ label, value, sub, delta, deltaPct, mono = true, size = "md", accent }: KpiProps) {
  const dir = deltaPct != null ? (deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "flat") : "flat";
  const valFs = size === "lg" ? 28 : size === "md" ? 22 : 18;
  const dirColors: Record<string, string> = { up: "var(--sim-up)", down: "var(--sim-down)", flat: "var(--sim-text-mute)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{label}</div>
      <div style={{
        fontSize: valFs, fontWeight: 600, letterSpacing: "-0.01em",
        fontFamily: mono ? "var(--sim-mono)" : "var(--sim-sans)",
        color: accent ?? "var(--sim-text)",
        lineHeight: 1.1,
      }}>{value}</div>
      {(delta !== undefined || sub) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          {delta !== undefined && (
            <span style={{ fontFamily: "var(--sim-mono)", fontWeight: 600, color: dirColors[dir] }}>
              {delta}
            </span>
          )}
          {sub && <span style={{ color: "var(--sim-text-mute)" }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}
