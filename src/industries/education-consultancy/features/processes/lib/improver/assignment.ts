import { agreement } from "../../../home/lib/assignment/outcome";
import type { Fact } from "./facts";
import type { TurnsOn } from "./memory";

/**
 * Smart assignment's REAL state, as Orca sees it (EDGEX-109 P4a round 2). Orca once proposed "assign automatically" while the feature was
 * off, had never run in shadow and nobody had room for today's leads. A change that turns smart assignment on must now cite this state,
 * and `auto` is refused unless the shadow run earned it. Pure.
 */

export const SHADOW_MIN_DAYS = 14;
const DAY = 86_400_000;

export interface AssignmentState {
  mode: "off" | "shadow" | "auto";
  /** Shadow decisions made in the last 30 days, and how many a human resolved as matched / overridden. */
  shadowDecisions30d: number;
  agreement: { matched: number; total: number; pct: number | null };
  /** Days since the first shadow decision (null: it never ran in shadow). */
  shadowDays: number | null;
  /** True when shadow has been running for at least 14 days AND still produced decisions in the last 14 days. */
  shadowRanLongEnough: boolean;
  /** Would the planner pick anyone for a new lead today (hard filters + today's cap)? */
  capacity: { found: boolean; eligible: number; poolSize: number };
}

export interface DecisionRow {
  mode: "shadow" | "auto";
  outcome: "matched" | "overridden" | "undone" | null;
  created_at: string;
}

export function shadowEvidence(
  rows: readonly DecisionRow[],
  now: Date,
): Pick<AssignmentState, "shadowDecisions30d" | "agreement" | "shadowDays" | "shadowRanLongEnough"> {
  const shadow = rows.filter((r) => r.mode === "shadow");
  const times = shadow.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const first = times.length ? Math.min(...times) : null;
  const within = (days: number) => shadow.filter((r) => now.getTime() - Date.parse(r.created_at) <= days * DAY);
  const last30 = within(30);
  const shadowDays = first === null ? null : Math.floor((now.getTime() - first) / DAY);
  return {
    shadowDecisions30d: last30.length,
    agreement: agreement(last30),
    shadowDays,
    shadowRanLongEnough: shadowDays !== null && shadowDays >= SHADOW_MIN_DAYS && within(SHADOW_MIN_DAYS).length > 0,
  };
}

export const STATE_FACT_ID = "assign.state";

/** The facts a turn-on change cites. The state fact is the one a turn-on change MUST cite. */
export function assignmentFacts(s: AssignmentState): Fact[] {
  const f = (id: string, label: string, display: string, raw: number | string | null): Fact => ({ id, label, display, raw, href: null });
  return [
    f(STATE_FACT_ID, "Smart assignment right now", `Smart assignment is ${s.mode}`, s.mode),
    f("assign.shadow_decisions", "Smart assignment shadow decisions, last 30 days", String(s.shadowDecisions30d), s.shadowDecisions30d),
    f("assign.shadow_agreement", "Smart assignment agreed with your managers", s.agreement.total ? `${s.agreement.matched} of ${s.agreement.total} (${s.agreement.pct}%)` : "no resolved decisions yet", s.agreement.pct),
    f("assign.shadow_days", "Days smart assignment has run in shadow", s.shadowDays === null ? "never ran in shadow" : `${s.shadowDays} ${s.shadowDays === 1 ? "day" : "days"}`, s.shadowDays),
    f("assign.capacity", "Capacity for a new lead today", s.capacity.found ? `${s.capacity.eligible} of ${s.capacity.poolSize} people could take a new lead today` : "nobody could take a new lead today", s.capacity.eligible),
  ];
}

/** Why a turn-on change must be dropped, or null when it may stand. */
export function turnsOnProblem(turnsOn: TurnsOn, s: AssignmentState, citedIds: readonly string[]): string | null {
  if (!citedIds.includes(STATE_FACT_ID)) return `A change that turns smart assignment on must cite the smart assignment state (${STATE_FACT_ID}).`;
  if (!s.capacity.found) return "Nobody has room to take a new lead today, so turning smart assignment on would assign no one: say so instead.";
  if (turnsOn === "smart_assignment_shadow") return s.mode === "off" ? null : `Smart assignment is already ${s.mode}: shadow is not the next step.`;
  // smart_assignment_auto
  if (s.mode === "auto") return "Smart assignment is already automatic.";
  if (!s.shadowRanLongEnough) return `Automatic assignment needs shadow mode to have run for at least ${SHADOW_MIN_DAYS} days with decisions; propose shadow first.`;
  return null;
}
