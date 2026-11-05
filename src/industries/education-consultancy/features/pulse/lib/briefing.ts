import { activityOf, type Briefing, type BriefingItem, type LeakReason, type PersonRow, type StageFlow, type MetricCounts, type PulseGroup } from "./types";
import type { PulseThresholds } from "./thresholds";
import { compareToUsual, usualShare } from "./compare";

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
  /** What the previous window is called in the UI ("last week", "yesterday", "the period before"). Default "last week". */
  baselineLabel?: string;
  /** false → the previous period starts before the data does: no trend claim is made from it. */
  baselineCovered?: boolean;
  /** "next week's" | "next month's" | "tomorrow's" — follows the window. Default next week's. */
  horizon?: string;
  /** New leads this window vs the previous one (for the intake direction). */
  newLeads?: { current: number; previous: number };
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
interface NegCtx { metricKey: (typeof METRICS)[number]["key"]; noun: string; fallPct: string; branchName: string | null; culpritName: string | null; culpritPct: string | null }

function negativeMoveCtx(input: BriefingInput): { item: BriefingItem; ctx: NegCtx } | null {
  if (input.baselineCovered === false) return null;
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
  const fallPct = pct(((best.cur - best.prev) / best.prev) * 100);
  if (!worst) {
    return {
      item: {
        id: "neg", tone: "bad", icon: "down", headline: `${head}.`, detail: `${best.cur} this period against ${best.prev} before.`,
        evidenceLabel: "Evidence", evidence: `${best.m.noun}: ${best.cur} vs ${best.prev} the period before`,
        link: { label: `${best.cur} leads`, drill: { metric: best.m.key } },
      },
      ctx: { metricKey: best.m.key, noun: best.m.noun, fallPct, branchName: null, culpritName: null, culpritPct: null },
    };
  }
  // Share of the GROSS decline (sum of the branches that fell) — a branch can fall by more than the team's NET drop
  // when another branch rose, so dividing by the net figure would exceed 100%.
  const gross = [...byBranch.values()].filter((b) => b.delta < 0).reduce((a, b) => a + Math.abs(b.delta), 0);
  const share = Math.abs(worst.delta) / gross;
  const clause = share >= 0.8 ? `${worst.name} accounts for nearly all of it` : share >= 0.5 ? `${worst.name} accounts for most of it` : `${worst.name} is the largest part of it`;
  // The person behind it: the largest activity drop vs usual in that branch (only if it is a real drop).
  const culprit = [...worst.people]
    .filter((p) => p.hasUsual !== false && activityOf(p.usual) >= input.thresholds.activityDropMinUsual && activityOf(p.current) < activityOf(p.usual) * 0.6)
    .sort((a, b) => activityOf(b.usual) - activityOf(b.current) - (activityOf(a.usual) - activityOf(a.current)))[0];
  const detail = culprit
    ? `${culprit.name}'s activity is at ${usualShare(activityOf(culprit.current), activityOf(culprit.usual))?.at ?? 0}% of usual.`
    : `${worst.name} went from ${worst.people.reduce((a, p) => a + p.previous[best!.m.key], 0)} to ${worst.people.reduce((a, p) => a + p.current[best!.m.key], 0)}.`;
  return {
    item: {
      id: "neg", tone: "bad", icon: "down",
      headline: `${head}, and ${clause}.`,
      detail,
      evidenceLabel: "Evidence",
      evidence: `${worst.name} (vs ${input.baselineLabel ?? "last week"}) −${Math.abs(worst.delta)} · team net −${best.drop}` + (culprit ? ` · ${culprit.name} ${culprit.current.calls} calls vs usual ${Math.round(culprit.usual.calls)}` : ""),
      link: culprit ? { label: `${culprit.current.calls} calls`, drill: { metric: "calls", userId: culprit.userId } } : { label: `${best.cur} leads`, drill: { metric: best.m.key } },
    },
    ctx: {
      metricKey: best.m.key, noun: best.m.noun, fallPct, branchName: worst.name,
      culpritName: culprit?.name ?? null, culpritPct: culprit ? `${usualShare(activityOf(culprit.current), activityOf(culprit.usual))?.at ?? 0}%` : null,
    },
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
    const cmp = compareToUsual(p.current[m.key], p.usual[m.key], p.hasUsual);
    const above = cmp && cmp.pct > 0 ? `, ${cmp.pct}% above their usual` : "";
    const peers = input.people.filter((x) => x.positionKey === p.positionKey);
    const avg = peers.length ? peers.reduce((a, x) => a + x.current[m.key], 0) / peers.length : 0;
    const total = input.team.current[m.key];
    return {
      id: "win", tone: "good", icon: "up",
      headline: `${p.name} delivered ${p.current[m.key]} of the ${total} ${m.key === "reached_applications" ? "students to Applications" : "leads to Prospects"}${above}.`,
      detail: "",
      evidenceLabel: "Evidence",
      evidence: `${p.positionLabel} average ${(Math.round(avg * 10) / 10).toString()}` + (cmp ? ` · ${p.name} usual ${Math.round(p.usual[m.key])}` : ""),
      link: { label: `${p.current[m.key]} ${m.key === "reached_applications" ? "students" : "leads"}`, drill: { metric: m.key, userId: p.userId } },
    };
  }
  return null;
}

/** (c) The biggest stage leak, with its top archive reason when the audit trail has one. */
export function biggestLeak(input: BriefingInput): { flow: StageFlow; reasons: LeakReason[]; rising: boolean } | null {
  // When the previous period is not covered by data, "up from N" is false: report the biggest leak WITHOUT a comparison.
  const rising = input.baselineCovered !== false;
  const flow = [...input.stageFlows].filter((f) => f.out >= Math.min(5, input.thresholds.stageLeakMin) && (!rising || f.out > f.previousOut)).sort((a, b) => b.out - a.out)[0];
  return flow ? { flow, reasons: input.leakReasons[flow.listId] ?? [], rising } : null;
}

function leak(input: BriefingInput): BriefingItem | null {
  const l = biggestLeak(input);
  if (!l) return null;
  const { flow, reasons, rising } = l;
  const top = reasons[0];
  const archived = reasons.reduce((a, r) => a + r.leads, 0);
  return {
    id: "leak", tone: "info", icon: "archive",
    headline: rising ? `More leads are leaving ${flow.name}: ${flow.out} this period, up from ${flow.previousOut}.` : `${flow.out} leads left ${flow.name} this period.`,
    detail: top ? `The top reason is "${top.reason}".` : "",
    evidenceLabel: "Pattern",
    evidence: top
      ? `${reasons.slice(0, 3).map((r) => `${r.reason} ${r.leads}`).join(" · ")} (of ${archived} archived with a reason)`
      : `${flow.out} of the ${flow.base} leads that were in ${flow.name} moved back or were archived`,
    link: { label: `${flow.out} leads`, drill: { metric: "stage_out", detail: flow.listId } },
  };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Orca's read: ONE synthesized paragraph that never restates an item headline.
 *  1. Direction: the strongest positive KPI move against the strongest negative one (or the negative trend alone).
 *  2. Facts with places and people: the fall, where it concentrated, who went quiet, what is waiting, what leaks.
 *  3. What to fix.
 * Every clause comes from a signal we hold; a clause whose signal is missing is skipped. Null with < 2 signals.
 */
function composeRead(input: BriefingInput, neg: { ctx: NegCtx } | null, win: BriefingItem | null, lk: BriefingItem | null): string | null {
  const signals = [neg, input.untouched.count > 0, lk, win].filter(Boolean).length;
  if (signals < 2) return null;
  const base = input.baselineLabel ?? "last week";

  // 1. strongest positive move (relative rise, needs a real base and a real change)
  const cands: Array<{ label: string; key: string; pct: number }> = [];
  const rise = (label: string, key: string, cur: number, prev: number) => {
    if (input.baselineCovered !== false && prev > 0 && cur - prev >= 3 && cur > prev) cands.push({ label, key, pct: ((cur - prev) / prev) * 100 });
  };
  if (input.newLeads) rise("Intake is", "intake", input.newLeads.current, input.newLeads.previous);
  rise("Prospects are", "prospects", input.team.current.prospects, input.team.previous.prospects);
  rise("Applications are", "reached_applications", input.team.current.reached_applications, input.team.previous.reached_applications);
  const up = cands.filter((c) => c.key !== neg?.ctx.metricKey).sort((x, y) => y.pct - x.pct)[0];
  const negPhrase = neg ? (neg.ctx.metricKey === "prospects" ? "fewer leads are moving forward" : "fewer students are reaching Applications") : null;
  const sentences: string[] = [];
  if (up && negPhrase) sentences.push(`${up.label} ${up.pct >= 50 ? "well ahead" : "up"}, but ${negPhrase}.`);
  else if (negPhrase) sentences.push(`${cap(negPhrase)} than ${base}.`);
  else if (up) sentences.push(`${up.label} ${up.pct >= 50 ? "well ahead of" : "ahead of"} ${base}.`);

  // 2. exactly the top TWO causes (fewer only if that is all we hold), worded differently from the item headlines
  const causes: string[] = [];
  if (neg) causes.push(`${neg.ctx.noun} fell ${neg.ctx.fallPct}${neg.ctx.branchName ? `, mostly in ${neg.ctx.branchName}` : ""}`);
  if (neg?.ctx.culpritName) causes.push(`${neg.ctx.culpritName} has gone quiet at ${neg.ctx.culpritPct} of the usual pace`);
  if (input.untouched.count > 0) causes.push(`${input.untouched.count} new lead${input.untouched.count === 1 ? " has" : "s have"} waited over 48 hours for a first touch`);
  const l = lk ? biggestLeak(input) : null;
  if (l) causes.push(`${l.flow.out} leads left ${l.flow.name} backwards or to Archive${l.rising ? `, up from ${l.flow.previousOut}` : ""}`);
  const used = causes.slice(0, 2);
  if (used.length) sentences.push(`${cap(used.join(", and "))}.`);

  // 3. what to fix: the number word matches the causes named above
  if (used.length >= 2) sentences.push(`Fix those two and ${input.horizon ?? "next week's"} Applications should hold.`);
  else if (used.length === 1) sentences.push(`Fix that and ${input.horizon ?? "next week's"} Applications should hold.`);
  return sentences.length >= 2 ? sentences.join(" ") : null;
}

export function buildBriefing(input: BriefingInput): Briefing | null {
  const negC = negativeMoveCtx(input), neg = negC?.item ?? null, win = topWin(input), lk = leak(input);
  const items = [neg, win, lk].filter((x): x is BriefingItem => !!x).slice(0, 3);
  const recordCount = recordCountOf(input.team.current);
  const read = composeRead(input, negC, win, lk);
  if (items.length === 0 && !read) return null;
  return { read, items, recordCount };
}
