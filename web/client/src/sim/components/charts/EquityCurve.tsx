interface EquityCurveProps {
  data: number[];
  baseline: number;
  height?: number;
}

function smoothPath(pts: [number, number][], tension = 0.3): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) return `M ${pts[0]![0]},${pts[0]![1]} L ${pts[1]![0]},${pts[1]![1]}`;

  let d = `M ${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(i + 2, n - 1)]!;

    d += ` C ${p1[0] + (p2[0] - p0[0]) * tension},${p1[1] + (p2[1] - p0[1]) * tension} ${p2[0] - (p3[0] - p1[0]) * tension},${p2[1] - (p3[1] - p1[1]) * tension} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function EquityCurve({ data, baseline, height = 200 }: EquityCurveProps) {
  if (!data || data.length === 0) return null;
  const W = 800, H = height;
  const padT = 8, padB = 24;
  const innerH = H - padT - padB;
  const min = Math.min(baseline, ...data) * 0.99;
  const max = Math.max(...data) * 1.01;
  const range = max - min || 1;
  const stepX = W / Math.max(data.length - 1, 1);
  const yOf = (v: number) => padT + innerH - ((v - min) / range) * innerH;

  const points: [number, number][] = data.map((d, i) => [i * stepX, yOf(d)]);
  const path = smoothPath(points);
  const lastPt = points[points.length - 1]!;
  const firstPt = points[0]!;
  const fillPath = path + ` L ${lastPt[0]},${H - padB} L ${firstPt[0]},${H - padB} Z`;
  const baseY = yOf(baseline);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1B2559" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#1B2559" stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={i} x1={0} x2={W} y1={padT + p * innerH} y2={padT + p * innerH} stroke="var(--sim-hairline)" strokeWidth="1" />
      ))}
      <line x1={0} x2={W} y1={baseY} y2={baseY} stroke="var(--sim-text-mute)" strokeDasharray="3 4" strokeWidth="1" />
      <path d={fillPath} fill="url(#eqGrad)" />
      <path d={path} fill="none" stroke="#1B2559" strokeWidth="1.6" />
      <text x={W - 6} y={baseY - 4} textAnchor="end" fontSize="10" fontFamily="var(--sim-mono)" fill="var(--sim-text-mute)">
        初始 ¥{baseline.toLocaleString()}
      </text>
    </svg>
  );
}
