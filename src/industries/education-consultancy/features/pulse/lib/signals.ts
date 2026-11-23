import type { PulseThresholds } from "./thresholds";
import { activityWhat } from "./activity-text";
import { MIN_OVER_CAPACITY_RATIO, MIN_USUAL, compareToUsual, usualShare } from "./compare";
import {
  activityOf,
  type BranchKpi,
  type PersonRow,
  type Signal,
  type StageFlow,
  type UntouchedSummary,
} from "./types";

/**
 * Rule-based signals — PURE functions, no I/O, no LLM. A later AI layer reads these typed signals (never raw
 * rows). Every signal carries evidence + a drill target so every claim is clickable.
 */

export const MAX_KEY_CHANGES = 4;
export const MAX_NEEDS_YOU = 4;

export interface SignalInput {
  people: PersonRow[];
  stageFlows: StageFlow[];
  untouched: UntouchedSummary;
  branchKpis: BranchKpi[];
  thresholds: PulseThresholds;
  baselineCovered?: boolean;
  /** How the window is named in sentences: "today" | "this week" | "this period" (default). */
  periodNoun?: string;
}

const SEVERITY_RANK = { high: 0, medium: 1, info: 2 } as const;

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** "Asha's activity dropped to 23% of usual"; when there is none (or it rounds to 0%) → "Asha has no activity yet today (usual 29 by now)". */
function dropTitle(p: PersonRow, current: number, usual: number, period: string): string {
  const at = usualShare(current, usual)?.at ?? Math.round((current / Math.round(usual)) * 100);
  return at <= 0 ? `${p.name} has ${activityWhat(p, current, usual, period)}` : `${p.name}'s activity dropped to ${at}% of usual`;
}

export function activityDropSignals(people: PersonRow[], t: PulseThresholds, period = "this period"): Signal[] {
  const out: Signal[] = [];
  for (const p of people) {
    const usual = activityOf(p.usual);
    const current = activityOf(p.current);
    if (p.hasUsual !== false && usual >= Math.max(t.activityDropMinUsual, MIN_USUAL) && current <= usual * t.activityDropRatio) {
      out.push({
        id: `activity_drop:${p.userId}`,
        kind: "activity_drop",
        severity: "high",
        title: dropTitle(p, current, usual, period),
        detail: `${current} calls, notes and stage moves vs usual ${Math.round(usual)}. Their leads may be going cold.`,
        evidence: { metric: "activity", value: current, baseline: usual },
        subject: { type: "person", id: p.userId },
        drill: { metric: "moves", userId: p.userId },
        action: "reassign",
        needs: {
          title: `Check in with ${p.name}`,
          detail: `${current} calls, notes and moves vs ${Math.round(usual)} usual. Cover their open leads if they are away.`,
        },
        surfaces: ["key_changes", "needs_you"],
        flag: "red",
        magnitude: usual - current,
        tone: "bad",
      });
    }
  }
  return out;
}

export function untouchedSignal(u: UntouchedSummary): Signal[] {
  if (u.count <= 0) return [];
  return [
    {
      id: "untouched_leads",
      kind: "untouched_leads",
      severity: "high",
      title: `${u.count} new lead${u.count === 1 ? "" : "s"} untouched for over 48 hours`,
      detail: "Nobody has called or noted these since they arrived.",
      evidence: { metric: "untouched_leads", value: u.count, baseline: 0 },
      subject: { type: "team", id: "all" },
      drill: { metric: "untouched" },
      action: "reassign",
      needs: {
        title: `Assign the ${u.count} untouched new lead${u.count === 1 ? "" : "s"}`,
        detail: "No call or note in 48+ hours. Spread them across the people who have capacity.",
      },
      surfaces: ["needs_you"],
      magnitude: u.count,
      tone: "bad",
    },
  ];
}

export function overCapacitySignals(people: PersonRow[], t: PulseThresholds): Signal[] {
  const out: Signal[] = [];
  for (const p of people) {
    const received = p.current.received;
    const usual = p.usual.received;
    const cmp = compareToUsual(received, usual, p.hasUsual);
    if (cmp && received >= t.overCapacityMin && cmp.ratio >= Math.max(t.overCapacityRatio, MIN_OVER_CAPACITY_RATIO)) {
      out.push({
        id: `over_capacity:${p.userId}`,
        kind: "over_capacity",
        severity: "medium",
        title: `${p.name} received ${received} new leads (usual ${Math.round(usual)})`,
        detail: "More than they usually handle — consider rebalancing before follow-ups slip.",
        evidence: { metric: "received", value: received, baseline: usual },
        subject: { type: "person", id: p.userId },
        drill: { metric: "received", userId: p.userId },
        action: "reassign",
        needs: {
          title: `Spread ${p.name}'s ${received} new leads`,
          detail: `Usual intake is ${Math.round(usual)}. Rebalance before follow-ups slip.`,
        },
        surfaces: ["key_changes", "needs_you"],
        flag: "amber",
        magnitude: received - usual,
        tone: "neutral",
      });
    }
  }
  return out;
}

export function stageLeakSignals(flows: StageFlow[], t: PulseThresholds, baselineCovered = true): Signal[] {
  const out: Signal[] = [];
  // No covered previous period → no "rising" claim: report only the single biggest leak, without a comparison.
  const pool = baselineCovered ? flows : [...flows].sort((a, b) => b.out - a.out).slice(0, 1);
  for (const f of pool) {
    if (f.out >= t.stageLeakMin && (!baselineCovered || f.out >= f.previousOut * t.stageLeakRatio)) {
      out.push({
        id: `stage_leak:${f.listId}`,
        kind: "stage_leak",
        severity: "medium",
        title: baselineCovered ? `${f.out} leads left ${f.name} backwards or to Archive (previous ${f.previousOut})` : `${f.out} leads left ${f.name} backwards or to Archive`,
        detail: baselineCovered ? `Out-rate from ${f.name} is at least ${t.stageLeakRatio}× the previous period.` : `The biggest stage leak this period.`,
        evidence: { metric: "stage_out", value: f.out, baseline: f.previousOut },
        subject: { type: "stage", id: f.listId },
        drill: { metric: "stage_out", detail: f.listId },
        surfaces: ["key_changes"],
        magnitude: f.out - f.previousOut,
        tone: "bad",
      });
    }
  }
  return out;
}

export function topMoverSignal(people: PersonRow[]): Signal[] {
  let best: { p: PersonRow; metric: "reached_applications" | "prospects"; delta: number } | null = null;
  // Headline metric first; fall through to prospects only when nobody improved on applications.
  for (const metric of ["reached_applications", "prospects"] as const) {
    for (const p of people) {
      const delta = p.current[metric] - p.usual[metric];
      if (!compareToUsual(p.current[metric], p.usual[metric], p.hasUsual)) continue;
      if (delta > 0 && (!best || delta > best.delta)) best = { p, metric, delta };
    }
    if (best) break;
  }
  if (!best) return [];
  const label = best.metric === "reached_applications" ? "students to Applications" : "prospects";
  return [
    {
      id: `top_mover:${best.metric}`,
      kind: "top_mover",
      severity: "info",
      title: `${best.p.name} moved ${best.p.current[best.metric]} ${label} (usual ${Math.round(best.p.usual[best.metric])})`,
      detail: `Largest improvement on ${label} this period.`,
      evidence: { metric: best.metric, value: best.p.current[best.metric], baseline: best.p.usual[best.metric] },
      subject: { type: "person", id: best.p.userId },
      drill: { metric: best.metric, userId: best.p.userId },
      surfaces: ["key_changes"],
      flag: "green",
      magnitude: best.delta,
      tone: "good",
    },
  ];
}

export function biggestDropSignal(kpis: BranchKpi[]): Signal[] {
  let worst: BranchKpi | null = null;
  let worstDelta = 0;
  for (const k of kpis) {
    if (k.hasUsual === false) continue;
    // Same guard and noise floor as the table: a real usual (5+) and at least a 25% fall.
    const cmp = compareToUsual(k.current, k.usual, k.hasUsual);
    if (!cmp || cmp.pct > -25) continue;
    const delta = k.current - Math.round(k.usual);
    if (delta < worstDelta) {
      worst = k;
      worstDelta = delta;
    }
  }
  if (!worst) return [];
  const what = worst.metric === "reached_applications" ? "students reaching Applications" : worst.metric.replace(/_/g, " ");
  return [
    {
      id: `biggest_drop:${worst.branchId}:${worst.metric}`,
      kind: "biggest_drop",
      severity: "info",
      title: `${worst.name}: ${what} down ${pct((-worstDelta / Math.round(worst.usual)) * 100)} vs usual`,
      detail: `${worst.current} vs usual ${Math.round(worst.usual)}.`,
      evidence: { metric: worst.metric, value: worst.current, baseline: worst.usual },
      subject: { type: "branch", id: worst.branchId },
      drill: { metric: worst.metric, branchId: worst.branchId },
      surfaces: ["key_changes"],
      magnitude: -worstDelta,
      tone: "bad",
    },
  ];
}

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.magnitude - a.magnitude || a.id.localeCompare(b.id),
  );
}

export interface ComputedSignals {
  all: Signal[];
  keyChanges: Signal[];
  needsYou: Signal[];
  /** userId → row flag. Red beats amber. */
  flags: Record<string, "red" | "amber" | "green">;
}

export function computeSignals(input: SignalInput): ComputedSignals {
  const all = sortSignals([
    ...activityDropSignals(input.people, input.thresholds, input.periodNoun),
    ...untouchedSignal(input.untouched),
    ...overCapacitySignals(input.people, input.thresholds),
    ...stageLeakSignals(input.stageFlows, input.thresholds, input.baselineCovered !== false),
    ...topMoverSignal(input.people),
    ...biggestDropSignal(input.branchKpis),
  ]);
  const flags: Record<string, "red" | "amber" | "green"> = {};
  const RANK = { red: 3, amber: 2, green: 1 } as const;
  for (const s of all) {
    if (!s.flag || s.subject.type !== "person") continue;
    const cur = flags[s.subject.id];
    if (!cur || RANK[s.flag] > RANK[cur]) flags[s.subject.id] = s.flag;
  }
  return {
    all,
    keyChanges: all.filter((s) => s.surfaces.includes("key_changes")).slice(0, MAX_KEY_CHANGES),
    needsYou: all.filter((s) => s.surfaces.includes("needs_you")).slice(0, MAX_NEEDS_YOU),
    flags,
  };
}
