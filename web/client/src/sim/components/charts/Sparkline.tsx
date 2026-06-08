interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  prevClose?: number;
}

export function Sparkline({ data, width = 120, height = 32, color, fill = true, prevClose }: SparklineProps) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = (max - min) || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((d, i) => `${i * stepX},${height - ((d - min) / range) * (height - 2) - 1}`);
  const path = "M " + points.join(" L ");
  const last = data[data.length - 1] ?? data[0] ?? 0;
  const ref = prevClose ?? data[0] ?? 0;
  const stroke = color ?? (last >= ref ? "var(--sim-up)" : "var(--sim-down)");
  const fillCol = last >= ref ? "rgba(215,38,61,0.10)" : "rgba(31,138,91,0.10)";
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && (
        <path d={path + ` L ${width},${height} L 0,${height} Z`} fill={fillCol} stroke="none" />
      )}
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
