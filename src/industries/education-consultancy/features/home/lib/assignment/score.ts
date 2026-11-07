import {
  CAP_SLACK,
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
  excluded: "inactive" | "on_leave" | "other_branch" | "flagged" | "at_cap" | null;
  fit: { rate: number; score: number; basis: "destination" | "overall"; destination: string | null };
  room: { held: number; roleMedian: number; score: number };
  speed: { minutes: number | null; score: number; source: "person" | "team" | "unknown" };
  present: { value: boolean; score: number };
  total: number;
  receivedToday: number;
}

export interface Decision {
  pickedUserId: string | null;
  /** Nobody passed the hard filters: the best by Fit + Room was picked anyway ("will be called when they start"). */
  fallback: boolean;
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
function hardFilter(c: Candidate, lead: LeadSignals): ScoredCandidate["excluded"] {
  if (!c.active) return "inactive";
  if (c.onLeave) return "on_leave";
  if (lead.branchId && c.branchId !== lead.branchId) return "other_branch";
  if (c.flag7d === "red" || c.flag7d === "amber") return "flagged";
  return null;
}

/**
 * Pick who gets a new lead. Hard filters first (active, not on leave, the lead's branch, not flagged red/amber in Pulse's
 * 7-day view, under today's cap), then a 0-100 score. Pure and deterministic: ties break on fewest leads received today,
 * then name. `pool` is already the first-touch position(s); the caller does that cut.
 */
export function decideAssignment(lead: LeadSignals, pool: Candidate[], team: Team): Decision {
  if (pool.length === 0) return { pickedUserId: null, fallback: false, why: "No one in the first-touch position can take it.", candidates: [] };

  const useDest = lead.destinations.length > 0 && lead.destinations.some((d) => (team.byDestination[d]?.received ?? 0) > 0);
  const tRateOverall = teamRate(team, null);
  const tRateFit = useDest ? teamRate(team, lead.destinations) : tRateOverall;

  const fitRate = (c: Candidate): number => {
    const overall = smoothedRate(c.overall.progressed, c.overall.received, tRateOverall);
    if (!useDest) return overall;
    const d = lead.destinations.reduce((a, k) => ({ r: a.r + (c.byDestination[k]?.received ?? 0), p: a.p + (c.byDestination[k]?.progressed ?? 0) }), { r: 0, p: 0 });
    return smoothedRate(d.p, d.r, overall);
  };

  // 1. Hard filters (cap is applied after the others, over the people still standing).
  const pre = pool.map((c) => ({ c, excluded: hardFilter(c, lead) }));
  const standing = pre.filter((x) => x.excluded === null).map((x) => x.c);
  const assignedToday = pool.reduce((s, c) => s + c.receivedToday, 0);
  const cap = standing.length > 0 ? Math.max(1, Math.ceil(((assignedToday + 1) / standing.length) * (1 + CAP_SLACK))) : 0;
  const excluded = new Map<string, ScoredCandidate["excluded"]>(pre.map((x) => [x.c.userId, x.excluded]));
  for (const c of standing) if (c.receivedToday >= cap) excluded.set(c.userId, "at_cap");
  const eligible = pool.filter((c) => excluded.get(c.userId) === null);
  const fallback = eligible.length === 0;
  // Fallback: nobody passes: rank the active people by Fit + Room alone.
  const ranked = fallback ? pool.filter((c) => c.active) : eligible;
  if (ranked.length === 0) {
    return { pickedUserId: null, fallback: false, why: "No active person in the first-touch position.", candidates: [] };
  }

  const maxFit = Math.max(...ranked.map(fitRate), 0);
  const heldByRole = new Map<string, number[]>();
  for (const c of ranked) heldByRole.set(c.positionKey, [...(heldByRole.get(c.positionKey) ?? []), c.heldOpen]);
  const roleMedian = (c: Candidate) => Math.max(1, median(heldByRole.get(c.positionKey) ?? [c.heldOpen]));

  function scoreOne(c: Candidate, inRace: boolean): ScoredCandidate {
    const rate = fitRate(c);
    const fit = { rate, score: inRace ? WEIGHTS.fit * (maxFit > 0 ? rate / maxFit : 1) : 0, basis: (useDest ? "destination" : "overall") as "destination" | "overall", destination: useDest ? lead.destinations[0] : null };
    const rm = roleMedian(c);
    const room = { held: c.heldOpen, roleMedian: rm, score: inRace ? WEIGHTS.room * clamp01(1 - c.heldOpen / (rm * ROOM_FACTOR)) : 0 };
    const own = c.overall.speedN >= MIN_SPEED_SAMPLES ? c.overall.medianFirstContactMin : null;
    const minutes = own ?? team.medianFirstContactMin;
    const source: ScoredCandidate["speed"]["source"] = own !== null ? "person" : team.medianFirstContactMin !== null ? "team" : "unknown";
    const speed = { minutes, source, score: inRace ? WEIGHTS.speed * (minutes === null ? SPEED_UNKNOWN : speedScore(minutes)) : 0 };
    const present = { value: c.present, score: inRace && c.present ? WEIGHTS.present : 0 };
    const total = fallback ? fit.score + room.score : fit.score + room.score + speed.score + present.score;
    return { userId: c.userId, name: c.name, eligible: !excluded.get(c.userId), excluded: excluded.get(c.userId) ?? null, fit, room, speed, present, total, receivedToday: c.receivedToday };
  }

  const raceIds = new Set(ranked.map((c) => c.userId));
  const scored = pool.map((c) => scoreOne(c, raceIds.has(c.userId)));
  const winners = scored
    .filter((s) => raceIds.has(s.userId))
    .sort((a, b) => b.total - a.total || a.receivedToday - b.receivedToday || a.name.localeCompare(b.name));
  const best = winners[0];
  const bestCand = pool.find((c) => c.userId === best.userId) as Candidate;
  return {
    pickedUserId: best.userId,
    fallback,
    why: explain(best, bestCand, winners, { tRateFit, useDest, destLabel: useDest ? lead.destinations.join("/") : null, teamSpeed: team.medianFirstContactMin }, fallback),
    candidates: scored,
  };
}

interface Ctx {
  tRateFit: number;
  useDest: boolean;
  destLabel: string | null;
  teamSpeed: number | null;
}

/** "Asha: best Australia record (42% vs team 31%) · 18 open leads (team median 24)": the top two factors, with numbers. */
export function explain(best: ScoredCandidate, cand: Candidate, field: ScoredCandidate[], ctx: Ctx, fallback: boolean): string {
  const isTopFit = field.every((o) => o.fit.rate <= best.fit.rate + 1e-9);
  const parts: Array<{ key: FactorKey; weight: number; text: string }> = [];
  const dest = ctx.useDest ? `${ctx.destLabel} ` : "";
  parts.push({
    key: "fit",
    weight: best.fit.score,
    text: `${isTopFit ? "best " : ""}${ctx.useDest ? `${dest}record` : "overall record"} (${pct(best.fit.rate)}% vs team ${pct(ctx.tRateFit)}%)`,
  });
  parts.push({ key: "room", weight: best.room.score, text: `${best.room.held} open leads (team median ${Math.round(best.room.roleMedian)})` });
  if (!fallback && best.speed.minutes !== null && best.speed.source === "person") {
    parts.push({ key: "speed", weight: best.speed.score, text: `first contact in ${Math.round(best.speed.minutes)} min${ctx.teamSpeed !== null ? ` (team ${Math.round(ctx.teamSpeed)} min)` : ""}` });
  }
  if (!fallback && cand.present) parts.push({ key: "present", weight: best.present.score, text: "active right now" });
  parts.sort((a, b) => b.weight - a.weight);
  const text = parts.slice(0, 2).map((p) => p.text).join(" · ");
  return `${best.name}: ${text}${fallback ? " · will be called when they start" : ""}`;
}
