interface MiniBarProps {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  label?: string;
}

export function MiniBar({ value, max = 1, color = "var(--sim-brand)", height = 6, label }: MiniBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <div style={{ flex: 1, height, background: "#EFEDE7", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: color, borderRadius: 999 }} />
      </div>
      {label && <span style={{ fontSize: 11.5, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)", minWidth: 36, textAlign: "right" }}>{label}</span>}
    </div>
  );
}
