import { mean } from "./window";

/** Need at least this many earlier windows with data before a person (or branch/team) has a "usual". */
export const MIN_COVERED_WINDOWS = 2;
export const USUAL_COUNT = 4;

export interface CoverageInput {
  /** Start of the current window and its length. */
  windowFrom: Date;
  lenMs: number;
  /** The tenant's first activity record; null = no data at all. */
  tenantFirst: Date | null;
}

/** When data for one person can start counting: after both the tenant's first record and the person's join date. */
export function firstAtFor(tenantFirst: Date | null, joinedAt: string | null | undefined): Date | null {
  if (!tenantFirst) return null;
  if (!joinedAt) return tenantFirst;
  const j = new Date(joinedAt);
  return Number.isNaN(j.getTime()) || j.getTime() < tenantFirst.getTime() ? tenantFirst : j;
}

/** Indices (0 = the window right before the current one) of the prior windows that START on or after `firstAt`. */
export function coveredUsualIndices(c: { windowFrom: Date; lenMs: number }, firstAt: Date | null, count = USUAL_COUNT): number[] {
  if (!firstAt) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (c.windowFrom.getTime() - c.lenMs * (i + 1) >= firstAt.getTime()) out.push(i);
  return out;
}

/** The previous window (index 0) is only a fair baseline if it starts on or after `firstAt`. */
export function previousCovered(c: { windowFrom: Date; lenMs: number }, firstAt: Date | null): boolean {
  return !!firstAt && c.windowFrom.getTime() - c.lenMs >= firstAt.getTime();
}

/** Mean over only the covered windows; null (no usual) when fewer than MIN_COVERED_WINDOWS are covered. */
export function coveredMean(valueAt: (windowIndex: number) => number, covered: number[]): number | null {
  return covered.length >= MIN_COVERED_WINDOWS ? mean(covered.map(valueAt)) : null;
}
