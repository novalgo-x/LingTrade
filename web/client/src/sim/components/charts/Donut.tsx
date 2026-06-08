interface DonutItem {
  value: number;
  color: string;
  label?: string;
}

interface DonutProps {
  data: DonutItem[];
  size?: number;
  thickness?: number;
}

export function Donut({ data, size = 160, thickness = 22 }: DonutProps) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) return null;
  const r = size / 2 - thickness / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let cum = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="#EFEDE7" strokeWidth={thickness} />
      {data.map((d, i) => {
        const len = (d.value / total) * circ;
        const dash = `${len} ${circ - len}`;
        const offset = -cum;
        cum += len;
        return (
          <circle key={i} cx={c} cy={c} r={r} fill="none"
            stroke={d.color} strokeWidth={thickness}
            strokeDasharray={dash} strokeDashoffset={offset}
            transform={`rotate(-90 ${c} ${c})`} />
        );
      })}
    </svg>
  );
}
