// Compact relative time for the Last activity column (EDGEX-117). Built on elapsed
// milliseconds, so it never depends on the viewer's timezone or calendar boundaries.
// Just now · 5m ago · 3h ago · 2d ago … 59d ago · 3mo ago · 2y ago.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const elapsed = now - then;
  if (elapsed < MIN) return "Just now"; // also covers a timestamp slightly in the future (clock skew)
  if (elapsed < HOUR) return `${Math.floor(elapsed / MIN)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  const days = Math.floor(elapsed / DAY);
  if (days < 60) return `${days}d ago`;
  if (days < 365) return `${Math.min(11, Math.floor(days / 30))}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
