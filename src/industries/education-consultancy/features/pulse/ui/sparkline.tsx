/** Tiny inline SVG line. `dashed` draws a flat reference line (the "usual") across the chart. */
export function Sparkline({
  values,
  color = "#2563eb",
  width = 96,
  height = 28,
  reference,
  fluid = false,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  reference?: number;
  /** Fill the parent's width instead of a fixed pixel width (funnel tiles shrink with the viewport). */
  fluid?: boolean;
}) {
  if (values.length < 2) return <div style={{ width, height }} aria-hidden />;
  const max = Math.max(...values, reference ?? 0, 1);
  const pad = 2;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fluid ? "none" : undefined} aria-hidden>
      {reference !== undefined && (
        <line x1={pad} x2={width - pad} y1={y(reference)} y2={y(reference)} stroke="#cbd5e1" strokeDasharray="3 3" vectorEffect={fluid ? "non-scaling-stroke" : undefined} />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect={fluid ? "non-scaling-stroke" : undefined} />
    </svg>
  );
}
