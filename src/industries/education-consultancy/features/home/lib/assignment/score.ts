import {
  CAP_SLACK,
  MIN_FIT_SAMPLES,
  MIN_SPEED_EVIDENCE,
  FIT_PRIOR,
  MIN_SPEED_SAMPLES,
  ROOM_FACTOR,
  SPEED_FAST_MIN,
  SPEED_SLOW_MIN,
  SPEED_UNKNOWN,
  WEIGHTS,
} from "./weights";
import type { LeadSignals } from "./signals";

export interface PersonStats {
  received: number;
  progressed: number;
  speedN: number;
  medianFirstContactMin: number | null;
}

export interface Candidate {
  userId: string;
  name: string;
  /** Normalized position key (pulse/lib/positions normalizePosition). */
  positionKey: string;
  branchId: string | null;
  /** Not suspended. */
  active: boolean;
  onLeave: boolean;
  /** Nobody working: no lead activity and no human note in the last DORMANT_DAYS days (a shared mailbox, a left-but-not-removed account). */
  dormant: boolean;
  /** Pulse's 7-day flag (nightly job). red = activity drop, amber = over capacity. */
  flag7d: "red" | "amber" | "green" | null;
  /** Open leads they hold now. */
  heldOpen: number;
  /** Leads reached them since the tenant-local start of today. */
  receivedToday: number;
  overall: PersonStats;
  /** Per destination: raw counts from the stats table. */
  byDestination: Record<string, { received: number; progressed: number }>;
  /** Clocked in today (when the tenant uses attendance) or any contact in the last 2 hours (otherwise). */
  present: boolean;
}

export interface Team {
  byDestination: Record<string, { received: number; progressed: number }>;
  overall: { received: number; progressed: number };
  medianFirstContactMin: number | null;
}

export type FactorKey = "fit" | "room" | "speed" | "present";

export interface ScoredCandidate {
  userId: string;
  name: string;
  eligible: boolean;
  /** Why they were filtered out (null when eligible). */
  excluded: "inactive" | "on_leave" | "dormant" | "other_branch" | "flagged" | "at_cap" | null;
  fit: { rate: number; score: number; basis: "destination" | "overall"; destination: string | null };
  /** `roleMedian` is floored at 1 for the score; `medianRaw` is the real median, what the why-line may cite. */
  room: { held: number; roleMedian: number; medianRaw: number; score: number };
  speed: { minutes: number | null; score: number; source: "person" | "team" | "unknown" };
  present: { value: boolean; score: number };
  total: number;
  receivedToday: number;
}

/** How the lead's branch was treated: "unstaffed" = nobody active in the pool sits in it (Admizz "Global"), so it filtered no one. */
export type BranchBasis = "none" | "staffed" | "unstaffed";

export interface Decision {
  /** Null when nobody passed the hard filters: the lead is NOT assigned and the owner's "Assign N new leads" row catches it. */
  pickedUserId: string | null;
  branch: BranchBasis;
  why: string;
  candidates: ScoredCandidate[];
}

const pct = (r: number) => Math.round(r * 100);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Smoothed rate: (progressed + prior x anchor) / (received + prior). Zero history returns the anchor. */
export function smoothedRate(progressed: number, received: number, anchor: number, prior = FIT_PRIOR): number {
  return (progressed + prior * anchor) / (received + prior);
}

function teamRate(team: Team, destinations: string[] | null): number {
  const pool = destinations
    ? destinations.reduce((a, d) => ({ r: a.r + (team.byDestination[d]?.received ?? 0), p: a.p + (team.byDestination[d]?.progressed ?? 0) }), { r: 0, p: 0 })
    : { r: team.overall.received, p: team.overall.progressed };
  return pool.r > 0 ? pool.p / pool.r : 0;
}

export function speedScore(minutes: number): number {
  if (minutes <= SPEED_FAST_MIN) return 1;
  if (minutes >= SPEED_SLOW_MIN) return 0;
  return 1 - (minutes - SPEED_FAST_MIN) / (SPEED_SLOW_MIN - SPEED_FAST_MIN);
}

/** Hard filters, in the order the brief lists them. null = passes. */
function hardFilter(c: Candidate, lead: LeadSignals, branchStaffed: boolean): ScoredCandidate["excluded"] {
  if (!c.active) return "inactive";
  if (c.onLeave) return "on_leave";
  if (c.dormant) return "dormant";
  // The branch only filters when someone active in the pool actually sits in it; otherwise it is not a filter.
  if (lead.branchId && branchStaffed && c.branchId !== lead.branchId) return "other_branch";
  if (c.flag7d === "red" || c.flag7d === "amber") return "flagged";
  return null;
}

/**
 * Pick who gets a new lead. Hard filters first (active, not on leave, working in the last 14 days, the lead's branch when
 * that branch has staff, not flagged red/amber in Pulse's 7-day view, under today's cap), then a 0-100 score. Pure and
 * deterministic: ties break on fewest leads received today, then name. `pool` is already the first-touch position(s); the
 * caller does that cut. If nobody passes, NO ONE is picked (the lead stays unassigned for a manager).
 */
export function decideAssignment(lead: LeadSignals, pool: Candidate[], team: Team): Decision {
  if (pool.length === 0) {
    return { pickedUserId: null, branch: "none", why: "No one is in the first-touch positions, so the lead stays unassigned.", candidates: [] };
  }

  const useDest = lead.destinations.length > 0 && lead.destinations.some((d) => (team.byDestination[d]?.received ?? 0) > 0);
  const tRateOverall = teamRate(team, null);
  const tRateFit = useDest ? teamRate(team, lead.destinations) : tRateOverall;

  const destOf = (c: Candidate) => lead.destinations.reduce((a, k) => ({ r: a.r + (c.byDestination[k]?.received ?? 0), p: a.p + (c.byDestination[k]?.progressed ?? 0) }), { r: 0, p: 0 });
  const fitRate = (c: Candidate): number => {
    const overall = smoothedRate(c.overall.progressed, c.overall.received, tRateOverall);
    if (!useDest) return overall;
    const d = destOf(c);
    return smoothedRate(d.p, d.r, overall);
  };

  // The lead's branch is a filter only when it has at least one active person in this pool.
  const branch: BranchBasis = !lead.branchId ? "none" : pool.some((c) => c.active && c.branchId === lead.branchId) ? "staffed" : "unstaffed";

  // 1. Hard filters (cap is applied after the others, over the people still standing).
  const pre = pool.map((c) => ({ c, excluded: hardFilter(c, lead, branch === "staffed") }));
  const standing = pre.filter((x) => x.excluded === null).map((x) => x.c);
  const assignedToday = pool.reduce((s, c) => s + c.receivedToday, 0);
  const cap = standing.length > 0 ? Math.max(1, Math.ceil(((assignedToday + 1) / standing.length) * (1 + CAP_SLACK))) : 0;
  const excluded = new Map<string, ScoredCandidate["excluded"]>(pre.map((x) => [x.c.userId, x.excluded]));
  for (const c of standing) if (c.receivedToday >= cap) excluded.set(c.userId, "at_cap");
  const ranked = pool.filter((c) => excluded.get(c.userId) === null);

  const maxFit = Math.max(...ranked.map(fitRate), 0);
  const heldByRole = new Map<string, number[]>();
  for (const c of ranked) heldByRole.set(c.positionKey, [...(heldByRole.get(c.positionKey) ?? []), c.heldOpen]);
  const rawMedian = (c: Candidate) => median(heldByRole.get(c.positionKey) ?? [c.heldOpen]);

  function scoreOne(c: Candidate, inRace: boolean): ScoredCandidate {
    const rate = fitRate(c);
    const fit = { rate, score: inRace ? WEIGHTS.fit * (maxFit > 0 ? rate / maxFit : 1) : 0, basis: (useDest ? "destination" : "overall") as "destination" | "overall", destination: useDest ? lead.destinations[0] : null };
    const medianRaw = rawMedian(c);
    const rm = Math.max(1, medianRaw);
    const room = { held: c.heldOpen, roleMedian: rm, medianRaw, score: inRace ? WEIGHTS.room * clamp01(1 - c.heldOpen / (rm * ROOM_FACTOR)) : 0 };
    const own = c.overall.speedN >= MIN_SPEED_SAMPLES ? c.overall.medianFirstContactMin : null;
    const minutes = own ?? team.medianFirstContactMin;
    const source: ScoredCandidate["speed"]["source"] = own !== null ? "person" : team.medianFirstContactMin !== null ? "team" : "unknown";
    const speed = { minutes, source, score: inRace ? WEIGHTS.speed * (minutes === null ? SPEED_UNKNOWN : speedScore(minutes)) : 0 };
    const present = { value: c.present, score: inRace && c.present ? WEIGHTS.present : 0 };
    const total = fit.score + room.score + speed.score + present.score;
    return { userId: c.userId, name: c.name, eligible: !excluded.get(c.userId), excluded: excluded.get(c.userId) ?? null, fit, room, speed, present, total, receivedToday: c.receivedToday };
  }

  const raceIds = new Set(ranked.map((c) => c.userId));
  const scored = pool.map((c) => scoreOne(c, raceIds.has(c.userId)));
  if (ranked.length === 0) {
    return { pickedUserId: null, branch, why: nobodyWhy(scored), candidates: scored };
  }
  const winners = scored
    .filter((s) => raceIds.has(s.userId))
    .sort((a, b) => b.total - a.total || a.receivedToday - b.receivedToday || a.name.localeCompare(b.name));
  const best = winners[0];
  const bestCand = pool.find((c) => c.userId === best.userId) as Candidate;
  const fitSample = useDest ? destOf(bestCand).r : bestCand.overall.received;
  return {
    pickedUserId: best.userId,
    branch,
    why: explain(best, bestCand, winners, {
      tRateFit,
      useDest,
      destLabel: useDest ? lead.destinations.join("/") : null,
      teamSpeed: team.medianFirstContactMin,
      fitSample,
    }),
    candidates: scored,
  };
}

const EXCLUDED_WORDS: Record<NonNullable<ScoredCandidate["excluded"]>, string> = {
  inactive: "suspended",
  on_leave: "on leave",
  dormant: "no activity in 14 days",
  other_branch: "in another branch",
  flagged: "flagged in Pulse",
  at_cap: "over today's share",
};

/** "No one can take it now (2 suspended, 1 on leave), so it stays unassigned." */
export function nobodyWhy(scored: ScoredCandidate[]): string {
  const counts = new Map<string, number>();
  for (const c of scored) if (c.excluded) counts.set(c.excluded, (counts.get(c.excluded) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => `${n} ${EXCLUDED_WORDS[k as NonNullable<ScoredCandidate["excluded"]>]}`);
  return `No one can take it now${parts.length ? ` (${parts.join(", ")})` : ""}, so it stays unassigned for a manager.`;
}

interface Ctx {
  tRateFit: number;
  useDest: boolean;
  destLabel: string | null;
  teamSpeed: number | null;
  /** How many leads the pick's Fit rate is based on (destination leads when destination-aware, else all). */
  fitSample: number;
}

/**
 * "Asha: best Australia record (42% vs team 31%) · 18 open leads (team median 24)": the top two factors WITH EVIDENCE.
 * A factor is cited only when there is data behind it: Fit needs a sample of at least MIN_FIT_SAMPLES leads and a team rate
 * above 0; Room needs a real team median of at least 1; Speed needs the person's own measured samples. With none, it says
 * "Most room" when that is true, else "Fewest new leads today". Never "0% vs team 0%".
 */
export function explain(best: ScoredCandidate, cand: Candidate, field: ScoredCandidate[], ctx: Ctx): string {
  const isTopFit = field.every((o) => o.fit.rate <= best.fit.rate + 1e-9);
  const parts: Array<{ key: FactorKey; weight: number; text: string }> = [];
  const dest = ctx.useDest ? `${ctx.destLabel} ` : "";
  if (ctx.fitSample >= MIN_FIT_SAMPLES && ctx.tRateFit > 0) {
    parts.push({
      key: "fit",
      weight: best.fit.score,
      text: `${isTopFit ? "best " : ""}${ctx.useDest ? `${dest}record` : "overall record"} (${pct(best.fit.rate)}% vs team ${pct(ctx.tRateFit)}%)`,
    });
  }
  if (best.room.medianRaw >= 1) {
    parts.push({ key: "room", weight: best.room.score, text: `${best.room.held} open leads (team median ${Math.round(best.room.medianRaw)})` });
  }
  if (best.speed.minutes !== null && best.speed.source === "person" && cand.overall.speedN >= MIN_SPEED_EVIDENCE) {
    parts.push({ key: "speed", weight: best.speed.score, text: `first contact in ${Math.round(best.speed.minutes)} min${ctx.teamSpeed !== null ? ` (team ${Math.round(ctx.teamSpeed)} min)` : ""}` });
  }
  if (cand.present) parts.push({ key: "present", weight: best.present.score, text: "active right now" });
  parts.sort((a, b) => b.weight - a.weight);
  if (parts.length === 0) {
    const mostRoom = field.some((o) => o.room.held > best.room.held) && field.every((o) => o.room.held >= best.room.held);
    return mostRoom
      ? `${best.name}: most room: ${best.room.held} open leads (team median ${Math.round(best.room.medianRaw)})`
      : `${best.name}: fewest new leads today`;
  }
  return `${best.name}: ${parts.slice(0, 2).map((p) => p.text).join(" \u00B7 ")}`;
}
