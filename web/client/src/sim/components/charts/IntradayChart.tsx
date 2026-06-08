interface IntradayChartProps {
  data: number[];
  prevClose: number;
  height?: number;
  showGrid?: boolean;
}

export function IntradayChart({ data, prevClose, height = 240, showGrid = true }: IntradayChartProps) {
  if (!data || data.length === 0) return null;
  const W = 800, H = height;
  const padT = 8, padB = 18;
  const innerW = W;
  const innerH = H - padT - padB;
  const min = Math.min(prevClose, ...data) * 0.998;
  const max = Math.max(prevClose, ...data) * 1.002;
  const range = (max - min) || 1;
  const stepX = innerW / (data.length - 1);
  const yOf = (v: number) => padT + innerH - ((v - min) / range) * innerH;
  const pts = data.map((d, i) => `${i * stepX},${yOf(d)}`);
  const path = "M " + pts.join(" L ");
  const last = data[data.length - 1] ?? prevClose;
  const up = last >= prevClose;
  const lineColor = up ? "var(--sim-up)" : "var(--sim-down)";
  const fillColor = up ? "rgba(215,38,61,0.10)" : "rgba(31,138,91,0.10)";
  const gridLevels = [-2, -1, 0, 1, 2].map(p => prevClose * (1 + p / 100));
  const times = ["09:30", "10:30", "11:30/13:00", "14:00", "15:00"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      {showGrid && gridLevels.map((v, i) => (
        <line key={i} x1={0} x2={W} y1={yOf(v)} y2={yOf(v)}
          stroke={i === 2 ? "#B6B0A4" : "var(--sim-hairline)"} strokeDasharray={i === 2 ? "4 4" : "2 4"} strokeWidth="1" />
      ))}
      {showGrid && [0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={"v" + i} x1={p * innerW} x2={p * innerW} y1={padT} y2={padT + innerH}
          stroke="var(--sim-hairline)" strokeWidth="1" />
      ))}
      <path d={path + ` L ${(data.length - 1) * stepX},${padT + innerH} L 0,${padT + innerH} Z`}
        fill={fillColor} stroke="none" />
      <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6" />
      {gridLevels.map((v, i) => {
        const pct = ((v - prevClose) / prevClose) * 100;
        const c = pct > 0 ? "var(--sim-up)" : pct < 0 ? "var(--sim-down)" : "var(--sim-text-mute)";
        return (
          <g key={"lbl" + i}>
            <text x={W - 4} y={yOf(v) - 3} textAnchor="end" fontSize="10" fill={c} fontFamily="var(--sim-mono)">
              {v.toFixed(2)}
            </text>
            <text x={4} y={yOf(v) - 3} fontSize="10" fill={c} fontFamily="var(--sim-mono)">
              {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
            </text>
          </g>
        );
      })}
      {times.map((t, i) => (
        <text key={t} x={(i / (times.length - 1)) * innerW} y={H - 4}
          textAnchor={i === 0 ? "start" : i === times.length - 1 ? "end" : "middle"}
          fontSize="10" fill="var(--sim-text-mute)" fontFamily="var(--sim-mono)">{t}</text>
      ))}
    </svg>
  );
}
