/**
 * THE one guard for every usual-based comparison (table deltas, over capacity, quiet / activity down, wins, branch
 * heads-up, briefing, drawer tiles). Null unless the usual is real: covered by data (`hasUsual`) and at least
 * MIN_USUAL — so "usual is 0", "140×" and "+12700%" cannot be produced anywhere.
 */
export const MIN_USUAL = 5;
/** Over capacity also needs the intake to be at least this multiple of usual. */
export const MIN_OVER_CAPACITY_RATIO = 2.5;

/** How a usual is printed (whole number). Every "usual N" in the UI and every % beside it goes through this. */
export const shownUsual = (usual: number) => Math.round(usual);

export interface Comparison {
  /** Rounded percentage change, e.g. 50 or −78. */
  pct: number;
  /** current / usual. */
  ratio: number;
}

export function compareToUsual(current: number, usual: number | null | undefined, hasUsual = true): Comparison | null {
  if (!hasUsual || usual == null || !Number.isFinite(usual) || usual < MIN_USUAL || !Number.isFinite(current)) return null;
  // The usual is PRINTED as a whole number everywhere, so the percentage is computed from that printed value:
  // "18 vs usual 6" must read +200%, never +227% (from a raw 5.5).
  const shown = Math.round(usual);
  return { pct: Math.round(((current - shown) / shown) * 100), ratio: current / shown };
}

/**
 * Display text for a change, never wider than ~5 characters: "+30%", "−47%", "−100%", and from +300% a multiplier
 * ("3.4×", "12×"). Null when there is nothing to show.
 */
export function formatChange(c: Comparison | null): string | null {
  if (!c) return null;
  if (c.pct >= 300) return `${c.ratio >= 10 ? Math.round(c.ratio) : (Math.round(c.ratio * 10) / 10).toString()}×`;
  if (c.pct === 0) return "±0";
  return `${c.pct > 0 ? "+" : "−"}${Math.abs(c.pct)}%`;
}

/**
 * The ONE rounding for "at Y% of usual" / "down X%": at = round(current / printed usual); down = 100 − at, so the pair
 * always sums to 100 (never "22% of usual" next to "down 77%"). Null without a real usual.
 */
export function usualShare(current: number, usual: number | null | undefined, hasUsual = true): { at: number; down: number } | null {
  if (!hasUsual || usual == null || !Number.isFinite(usual) || usual < MIN_USUAL || !Number.isFinite(current)) return null;
  const at = Math.round((current / Math.round(usual)) * 100);
  return { at, down: 100 - at };
}

/** A change shown in a table cell or a drawer tile is quiet below this size. */
export const MIN_SHOWN_CHANGE_PCT = 25;

/**
 * THE one "show a change?" rule for cells and tiles: compareToUsual (real usual, printed-usual maths) AND at least
 * MIN_SHOWN_CHANGE_PCT off. `rise` colours an increase (bad = red, warn = amber); otherwise up = green, down = red.
 */
export function changeVsUsual(
  current: number,
  usual: number | null | undefined,
  hasUsual = true,
  rise?: "bad" | "warn",
): { text: string; cls: "up" | "dn" | "am"; pct: number } | null {
  const cmp = compareToUsual(current, usual, hasUsual);
  if (!cmp || Math.abs(cmp.pct) < MIN_SHOWN_CHANGE_PCT) return null;
  const up = cmp.pct > 0;
  const text = formatChange(cmp) ?? "";
  if (rise && up) return { text, cls: rise === "warn" ? "am" : "dn", pct: cmp.pct };
  return { text, cls: up ? "up" : "dn", pct: cmp.pct };
}
