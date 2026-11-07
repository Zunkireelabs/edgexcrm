import { LEARN_COVERAGE } from "./weights";

export interface LearnMember {
  userId: string;
  /** Position slug, null when the member has none. */
  slug: string | null;
  name: string | null;
  suspended: boolean;
}

export interface LearnedPositions {
  /** Every position that received new leads, biggest first: what the Settings card shows. */
  positions: Array<{ slug: string; name: string; count: number }>;
  /** The positions that together cover at least LEARN_COVERAGE of the new leads, in that order. */
  chosen: string[];
  /** New leads received by current, active members in the window. */
  total: number;
  covered: number;
}

/**
 * Who takes new leads on this tenant, learned instead of assumed. Counts the new leads each CURRENT, ACTIVE member received in
 * the window (members who left or are suspended don't count, a suspended TeleCaller is not a first-touch person), groups them by
 * position, and takes the biggest positions until they cover `coverage` of the total. Ties break on the slug.
 * Admizz: Counselors 71 + Lead Executives 33 -> both (Counselors alone is 68%).
 */
export function learnFirstTouchPositions(
  members: LearnMember[],
  receivedByUser: Record<string, number>,
  coverage: number = LEARN_COVERAGE,
): LearnedPositions {
  const byPos = new Map<string, { slug: string; name: string; count: number }>();
  for (const m of members) {
    if (m.suspended || !m.slug) continue;
    const n = receivedByUser[m.userId] ?? 0;
    if (n <= 0) continue;
    const e = byPos.get(m.slug) ?? { slug: m.slug, name: m.name || m.slug, count: 0 };
    e.count += n;
    byPos.set(m.slug, e);
  }
  const positions = [...byPos.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
  const total = positions.reduce((s, p) => s + p.count, 0);
  const chosen: string[] = [];
  let covered = 0;
  for (const p of positions) {
    if (total > 0 && covered / total >= coverage) break;
    chosen.push(p.slug);
    covered += p.count;
  }
  return { positions, chosen, total, covered };
}
