import { activityOf, type Briefing, type BriefingItem, type LeakReason, type PersonRow, type StageFlow, type MetricCounts, type PulseGroup } from "./types";
import type { PulseThresholds } from "./thresholds";

/**
 * "Preview mode": the briefing the LLM layer will later write, built TODAY from real numbers by deterministic
 * templates. Every sentence is computed from the inputs and carries a drill target; a line whose data is missing is
 * skipped, never invented. No pronouns are guessed — people are referred to by name.
 */

export interface BriefingInput {
  people: PersonRow[];
  team: PulseGroup;
  stageFlows: StageFlow[];
  /** Top archive reasons per stage id (only stages that have any). */
  leakReasons: Record<string, LeakReason[]>;
  untouched: { count: number };
  thresholds: PulseThresholds;
}

const METRICS = [
  { key: "prospects", noun: "Prospects", verb: "moved to Prospects" },
  { key: "reached_applications", noun: "Students reaching Applications", verb: "reached Applications" },
] as const;

const pct = (n: number) => `${Math.round(Math.abs(n))}%`;

export function recordCountOf(c: MetricCounts): number {
  return c.calls + c.notes + c.moves + c.back_archived + c.status_changes + c.received + c.applications_filed;
}

/** (a) The biggest negative KPI move vs the previous window, explained by its largest contributing branch + person. */
function negativeMove(input: BriefingInput): BriefingItem | null {
  let best: { m: (typeof METRICS)[number]; prev: number; cur: number; drop: number } | null = null;
  for (const m of METRICS) {
    const cur = input.team.current[m.key], prev = input.team.previous[m.key];
    const drop = prev - cur;
    if (prev > 0 && drop >= 5 && drop / prev >= 0.1 && (!best || drop / prev > best.drop / best.prev)) best = { m, prev, cur, drop };
  }
  if (!best) return null;

  const byBranch = new Map<string, { name: string; delta: number; people: PersonRow[] }>();
  for (const p of input.people) {
    if (!p.branchId) continue;
    const b = byBranch.get(p.branchId) ?? { name: p.branchName ?? "A branch", delta: 0, people: [] };
    b.delta += p.current[best.m.key] - p.previous[best.m.key];
    b.people.push(p);
    byBranch.set(p.branchId, b);
  }
  const worst = [...byBranch.values()].filter((b) => b.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const head = `${best.m.noun} fell ${pct(((best.cur - best.prev) / best.prev) * 100)}`;
  if (!worst) {
    return {
      id: "neg", tone: "bad", icon: "down", headline: `${head}.`, detail: `${best.cur} this period against ${best.prev} before.`,
      evidenceLabel: "Evidence", evidence: `${best.m.noun}: ${best.cur} vs ${best.prev} the period before`,
      link: { label: `${best.cur} leads`, drill: { metric: best.m.key } },
    };
  }
  // Share of the GROSS decline (sum of the branches that fell) — a branch can fall by more than the team's NET drop
  // when another branch rose, so dividing by the net figure would exceed 100%.
  const gross = [...byBranch.values()].filter((b) => b.delta < 0).reduce((a, b) => a + Math.abs(b.delta), 0);
  const share = Math.abs(worst.delta) / gross;
  const clause = share >= 0.8 ? `${worst.name} accounts for nearly all of it` : share >= 0.5 ? `${worst.name} accounts for most of it` : `${worst.name} is the largest part of it`;
  // The person behind it: the largest activity drop vs usual in that branch (only if it is a real drop).
  const culprit = [...worst.people]
    .filter((p) => activityOf(p.usual) >= input.thresholds.activityDropMinUsual && activityOf(p.current) < activityOf(p.usual) * 0.6)
    .sort((a, b) => activityOf(b.usual) - activityOf(b.current) - (activityOf(a.usual) - activityOf(a.current)))[0];
  const detail = culprit
    ? `${culprit.name}'s activity is at ${pct((activityOf(culprit.current) / activityOf(culprit.usual)) * 100)} of usual.`
    : `${worst.name} went from ${worst.people.reduce((a, p) => a + p.previous[best!.m.key], 0)} to ${worst.people.reduce((a, p) => a + p.current[best!.m.key], 0)}.`;
  return {
    id: "neg", tone: "bad", icon: "down",
    headline: `${head}, and ${clause}.`,
    detail,
    evidenceLabel: "Evidence",
    evidence: `${worst.name} −${Math.abs(worst.delta)} · team net −${best.drop}` + (culprit ? ` · ${culprit.name} ${culprit.current.calls} calls vs usual ${Math.round(culprit.usual.calls)}` : ""),
    link: culprit ? { label: `${culprit.current.calls} calls`, drill: { metric: "calls", userId: culprit.userId } } : { label: `${best.cur} leads`, drill: { metric: best.m.key } },
  };
}

/** (b) The top win: the person furthest above their own usual on students reaching Applications (else Prospects). */
function topWin(input: BriefingInput): BriefingItem | null {
  for (const m of METRICS.slice().reverse()) {
    const ranked = input.people
      .map((p) => ({ p, d: p.current[m.key] - p.usual[m.key] }))
      .filter((x) => x.d > 0 && x.p.current[m.key] >= 3)
      .sort((a, b) => b.d - a.d);
    const top = ranked[0];
    if (!top) continue;
    const { p } = top;
    const above = p.usual[m.key] > 0 ? ` — ${pct(((p.current[m.key] - p.usual[m.key]) / p.usual[m.key]) * 100)} above their usual` : "";
    const peers = input.people.filter((x) => x.positionKey === p.positionKey);
    const avg = peers.length ? peers.reduce((a, x) => a + x.current[m.key], 0) / peers.length : 0;
    const total = input.team.current[m.key];
    return {
      id: "win", tone: "good", icon: "up",
      headline: `${p.name} delivered ${p.current[m.key]} of the ${total} ${m.key === "reached_applications" ? "students to Applications" : "leads to Prospects"}${above}.`,
      detail: "",
      evidenceLabel: "Evidence",
      evidence: `${p.positionLabel} average ${(Math.round(avg * 10) / 10).toString()} · ${p.name} usual ${Math.round(p.usual[m.key])}`,
      link: { label: `${p.current[m.key]} ${m.key === "reached_applications" ? "students" : "leads"}`, drill: { metric: m.key, userId: p.userId } },
    };
  }
  return null;
}

/** (c) The biggest stage leak, with its top archive reason when the audit trail has one. */
export function biggestLeak(input: BriefingInput): { flow: StageFlow; reasons: LeakReason[] } | null {
  const flow = [...input.stageFlows].filter((f) => f.out >= Math.min(5, input.thresholds.stageLeakMin) && f.out > f.previousOut).sort((a, b) => b.out - a.out)[0];
  return flow ? { flow, reasons: input.leakReasons[flow.listId] ?? [] } : null;
}

function leak(input: BriefingInput): BriefingItem | null {
  const l = biggestLeak(input);
  if (!l) return null;
  const { flow, reasons } = l;
  const top = reasons[0];
  const archived = reasons.reduce((a, r) => a + r.leads, 0);
  return {
    id: "leak", tone: "info", icon: "archive",
    headline: `More leads are leaving ${flow.name}: ${flow.out} this period, up from ${flow.previousOut}.`,
    detail: top ? `The top reason is "${top.reason}".` : "",
    evidenceLabel: "Pattern",
    evidence: top
      ? `${reasons.slice(0, 3).map((r) => `${r.reason} ${r.leads}`).join(" · ")} (of ${archived} archived with a reason)`
      : `${flow.out} of the ${flow.base} leads that were in ${flow.name} moved back or were archived`,
    link: { label: `${flow.out} leads`, drill: { metric: "stage_out", detail: flow.listId } },
  };
}

export function buildBriefing(input: BriefingInput): Briefing | null {
  const neg = negativeMove(input), win = topWin(input), lk = leak(input);
  const items = [neg, win, lk].filter((x): x is BriefingItem => !!x).slice(0, 3);
  const recordCount = recordCountOf(input.team.current);
  // Orca's read is composed ONLY from the same facts, and only when there are at least two meaningful signals.
  const facts: string[] = [];
  if (neg) facts.push(neg.headline.replace(/\.$/, "") + (neg.detail.includes("activity") ? ` — ${neg.detail.replace(/\.$/, "")}` : "") + ".");
  if (input.untouched.count > 0) facts.push(`${input.untouched.count} new lead${input.untouched.count === 1 ? " has" : "s have"} waited over 48 hours for a first touch.`);
  if (lk) facts.push(lk.headline);
  if (win) facts.push(win.headline);
  const read = facts.length >= 2 ? facts.slice(0, 3).join(" ") : null;
  if (items.length === 0 && !read) return null;
  return { read, items, recordCount };
}
