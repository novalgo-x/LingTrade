interface PulseDotProps {
  color?: string;
}

export function PulseDot({ color = "var(--sim-down)" }: PulseDotProps) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 8, height: 8 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%", background: color,
        animation: "sim-pulse 1.6s ease-out infinite", opacity: 0.5,
      }} />
      <span style={{
        position: "absolute", inset: 1, borderRadius: "50%", background: color,
      }} />
    </span>
  );
}
