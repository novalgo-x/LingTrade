interface KLineData {
  open: number;
  close: number;
  high: number;
  low: number;
  vol: number;
}

interface KLineChartProps {
  data: KLineData[];
  height?: number;
}

export function KLineChart({ data, height = 280 }: KLineChartProps) {
  if (!data || data.length === 0) return null;
  const W = 800, H = height;
  const padT = 8, padB = 60;
  const priceH = H - padT - padB - 4;
  const volH = 40;
  const volY = H - padB + 18;
  const innerW = W;
  const min = Math.min(...data.map(d => d.low)) * 0.998;
  const max = Math.max(...data.map(d => d.high)) * 1.002;
  const range = max - min || 1;
  const candleW = Math.max(2, (innerW / data.length) * 0.65);
  const stepX = innerW / data.length;
  const yOf = (v: number) => padT + priceH - ((v - min) / range) * priceH;
  const maxVol = Math.max(...data.map(d => d.vol));
  const vBarH = (v: number) => (v / maxVol) * volH;

  const ma = (n: number, i: number): number | null => {
    if (i < n - 1) return null;
    let s = 0;
    for (let k = 0; k < n; k++) s += data[i - k]!.close;
    return s / n;
  };

  const maLine = (n: number, color: string) => {
    const pts: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const v = ma(n, i);
      if (v === null) continue;
      pts.push(`${(i + 0.5) * stepX},${yOf(v)}`);
    }
    if (pts.length < 2) return null;
    return <path d={"M " + pts.join(" L ")} fill="none" stroke={color} strokeWidth="1.2" opacity="0.9" />;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={i} x1={0} x2={W} y1={padT + p * priceH} y2={padT + p * priceH} stroke="var(--sim-hairline)" strokeWidth="1" />
      ))}
      {maLine(5, "#C2410C")}
      {maLine(20, "#1B2559")}
      {maLine(60, "#9A6700")}
      {data.map((d, i) => {
        const up = d.close >= d.open;
        const x = i * stepX + (stepX - candleW) / 2;
        const cx = i * stepX + stepX / 2;
        const color = up ? "var(--sim-up)" : "var(--sim-down)";
        const yHigh = yOf(d.high), yLow = yOf(d.low);
        const yOpen = yOf(d.open), yClose = yOf(d.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yOpen - yClose));
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1" />
            <rect x={x} y={bodyTop} width={candleW} height={bodyH} fill={color} />
            <rect x={x} y={volY + (volH - vBarH(d.vol))} width={candleW} height={vBarH(d.vol)} fill={color} opacity="0.55" />
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
        const v = max - p * range;
        return (
          <text key={"p" + i} x={W - 4} y={padT + p * priceH + 3}
            textAnchor="end" fontSize="10" fill="var(--sim-text-mute)" fontFamily="var(--sim-mono)">
            {v.toFixed(2)}
          </text>
        );
      })}
      <g transform={`translate(6, ${padT + 12})`} fontSize="10" fontFamily="var(--sim-mono)">
        <text fill="#C2410C">MA5</text>
        <text x={36} fill="#1B2559">MA20</text>
        <text x={76} fill="#9A6700">MA60</text>
      </g>
    </svg>
  );
}
