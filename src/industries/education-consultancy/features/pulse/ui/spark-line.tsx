/** The metric tile's sparkline: a 96×28 polyline (1.6px, accent) exactly like the mockup. Empty → a spacer, never a fake line. */
export function SparkLine({ values }: { values: number[] }) {
  if (values.length < 2) return <svg width={96} height={28} aria-hidden />;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${((i * 96) / (values.length - 1)).toFixed(1)},${(26 - (v / max) * 24).toFixed(1)}`).join(" ");
  return (
    <svg width={96} height={28} aria-hidden>
      <polyline points={pts} fill="none" stroke="#2272B4" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
