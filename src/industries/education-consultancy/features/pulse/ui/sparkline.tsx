/** Sparklines drawn exactly like the mockup: a polyline in a 0 0 100 26 box stretched to the tile's width. */
function points(values: number[], w: number, h: number, max: number, pad = 2): string {
  const x = (i: number) => (i * w) / Math.max(values.length - 1, 1);
  const y = (v: number) => h - pad - (v / Math.max(max, 1)) * (h - pad * 2);
  return values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

/** Funnel-tile sparkline: full width, 26px tall, 1.8px stroke (.spark in the mockup). */
export function FlowSpark({ values, color }: { values: number[]; color: string }) {
  // No series (e.g. applications filed has no per-day data) → an empty spacer, never a flat zero line that reads as data.
  if (values.length < 2) return <div className="mt-1.5 h-[26px]" aria-hidden />;
  const v = values;
  const max = Math.max(...v, 1);
  return (
    <svg className="mt-1.5 block h-[26px] w-full" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden>
      <polyline points={points(v, 100, 26, max)} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Row trend: 66×26, a dashed line at the person's usual, the polyline over it (the "Trend vs usual" column). */
export function TrendSpark({ values, usual, color }: { values: number[]; usual: number; color: string }) {
  const v = values.length >= 2 ? values : [0, 0];
  const max = Math.max(...v, usual, 1);
  const ref = 26 - 2 - (usual / max) * 22;
  return (
    <svg width={66} height={26} viewBox="0 0 86 26" preserveAspectRatio="none" aria-hidden>
      <line x1={0} y1={ref} x2={86} y2={ref} stroke="#e5e7eb" strokeDasharray="3 3" />
      <polyline points={points(v, 86, 26, max)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
