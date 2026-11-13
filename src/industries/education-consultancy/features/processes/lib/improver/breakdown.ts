import { fmtValue } from "../format";
import type { ProcessKey } from "../keys";
import { fmtN, formatMinutes, METRIC_REGISTRY, readMetric, stepStatus, type RawMetrics } from "../metrics";
import type { ProcessSpec } from "../spec";
import { DAY_NAMES_FULL } from "../working-hours";
import type { Fact } from "./facts";
import { cohortHref, intakeLeftoverHref, weekdayHref, type ImproverWindow } from "./links";

/** The fixed menu of SQL cuts per process (migration 289). The tool offers exactly these names; anything else is refused before the database. */
export const CUTS: Record<ProcessKey, readonly string[]> = {
  new_lead_first_call: ["by_weekday", "office_split", "by_hour_band", "by_branch", "by_owner_position", "wait_percentiles", "intake_leftovers"],
  visa_to_enrolled: ["by_branch"],
  dropping_a_student: ["by_branch"],
  leaver_handover: [],
};

export const CUT_HELP: Record<string, string> = {
  by_weekday: "new leads by the weekday they arrived: how many, how many were called within 1 hour / 1 working hour, how long first contact took",
  office_split: "new leads that arrived inside vs outside office hours, with the same numbers",
  by_hour_band: "new leads by arrival hour band (00-06, 06-09, 09-12, 12-15, 15-18, 18-24)",
  by_branch: "the same numbers per branch",
  by_owner_position: "the same numbers by the position of the lead's owner (or unassigned)",
  wait_percentiles: "median / 75th / 90th percentile of the wait for an owner and for first contact, all new leads",
  intake_leftovers: "unassigned leads still sitting in intake lists, by how long they have waited",
};

export interface BreakdownCtx {
  key: ProcessKey;
  window: ImproverWindow;
  /** Every lead list id of the tenant (named in cohort links so intake/staging leads show). */
  listIds: readonly string[];
  intakeListIds: readonly string[];
  positionNames: ReadonlyMap<string, string>;
  /** All new leads in the window (the cohort size), for "17 of 122". */
  arrived: number;
}

interface RawGroup {
  key: string;
  label?: string | null;
  n?: number;
  called_1h?: number;
  called_1wh?: number;
  never?: number;
  contact_p50?: number | null;
  contact_p75?: number | null;
  contact_p90?: number | null;
  wait_p50?: number | null;
  wait_p75?: number | null;
  wait_p90?: number | null;
  won_not_enrolled?: number;
  moved_to_enrolled?: number;
  dropped?: number;
}
export interface RawBreakdown {
  cut: string;
  groups: RawGroup[];
  total?: number;
  oldest_days?: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (n: number, d: number): string => fmtValue(d > 0 ? (n / d) * 100 : null, "percent");

const BANDS: Record<string, string> = { "00-06": "00:00–06:00", "06-09": "06:00–09:00", "09-12": "09:00–12:00", "12-15": "12:00–15:00", "15-18": "15:00–18:00", "18-24": "18:00–24:00" };
const AGE_BANDS: Record<string, string> = { "1": "under 1 day", "2": "1 to 3 days", "3": "3 to 7 days", "4": "7 days or more" };
const days = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

function groupLabel(cut: string, g: RawGroup, ctx: BreakdownCtx): string {
  switch (cut) {
    case "by_weekday":
      return DAY_NAMES_FULL[Number(g.key)] ?? g.key;
    case "office_split":
      return g.key === "inside" ? "Arrived inside office hours" : "Arrived outside office hours";
    case "by_hour_band":
      return `Arrived ${BANDS[g.key] ?? g.key}`;
    case "by_branch":
      return g.label ?? (g.key === "none" ? "No branch" : "Branch");
    case "by_owner_position":
      return g.key === "unassigned" ? "Not assigned yet" : g.key === "no-position" ? "Owner without a position" : (ctx.positionNames.get(g.key) ?? g.key);
    case "intake_leftovers":
      return `Waiting ${AGE_BANDS[g.key] ?? g.key}`;
    default:
      return "All new leads";
  }
}

export interface FactRef {
  id: string;
  display: string;
  /** True when citing this fact gives evidence a link that opens exactly the counted leads. */
  linkable: boolean;
}
export interface GroupView {
  key: string;
  label: string;
  facts: Record<string, FactRef>;
}

/** The facts and the model-facing view of one cut. A fact's href is kept in the store; it never goes to the model. */
export function breakdownFacts(cut: string, raw: RawBreakdown, ctx: BreakdownCtx): { facts: Fact[]; groups: GroupView[]; total: FactRef | null } {
  const facts: Fact[] = [];
  const groups: GroupView[] = [];
  const add = (id: string, label: string, display: string, value: number | string | null, href: string | null, view: GroupView, name: string): void => {
    facts.push({ id, label, display, raw: value, href });
    view.facts[name] = { id, display, linkable: href !== null };
  };

  if (cut === "intake_leftovers") {
    const total = raw.total ?? 0;
    const href = intakeLeftoverHref(ctx.intakeListIds);
    facts.push({ id: "intake.total", label: "Enquiries still unassigned in the intake lists", display: fmtN(total), raw: total, href });
    for (const g of raw.groups) {
      const v: GroupView = { key: g.key, label: groupLabel(cut, g, ctx), facts: {} };
      add(`intake.${g.key}.n`, `Unassigned intake enquiries waiting ${AGE_BANDS[g.key] ?? g.key}`, fmtN(g.n ?? 0), g.n ?? 0, null, v, "n");
      groups.push(v);
    }
    if (raw.oldest_days != null) {
      const display = days(raw.oldest_days);
      facts.push({ id: "intake.oldest", label: "The oldest unassigned enquiry has waited", display, raw: raw.oldest_days, href });
      groups.push({ key: "oldest", label: "Oldest", facts: { waited: { id: "intake.oldest", display, linkable: href !== null } } });
    }
    return { facts, groups, total: { id: "intake.total", display: fmtN(total), linkable: href !== null } };
  }

  const cohort = cohortHref(ctx.window, ctx.listIds);
  for (const g of raw.groups) {
    const view: GroupView = { key: g.key, label: groupLabel(cut, g, ctx), facts: {} };
    const base = `${cut}.${g.key}`;
    const lab = view.label;
    const href = cut === "by_weekday" ? weekdayHref(ctx.window, ctx.listIds, Number(g.key)) : cut === "wait_percentiles" ? cohort : null;

    if (ctx.key === "new_lead_first_call") {
      const n = g.n ?? 0;
      add(`${base}.size`, `${lab}: new leads`, `${fmtN(n)} of ${fmtN(ctx.arrived)}`, n, href, view, "size");
      add(`${base}.called_1h_pct`, `${lab}: called within 1 hour`, pct(g.called_1h ?? 0, n), n > 0 ? ((g.called_1h ?? 0) / n) * 100 : null, href, view, "called_within_1_hour_pct");
      add(`${base}.called_1wh_pct`, `${lab}: called within 1 working hour`, pct(g.called_1wh ?? 0, n), n > 0 ? ((g.called_1wh ?? 0) / n) * 100 : null, href, view, "called_within_1_working_hour_pct");
      add(`${base}.never`, `${lab}: never contacted`, `${fmtN(g.never ?? 0)} of ${fmtN(n)}`, g.never ?? 0, href, view, "never_contacted");
      const timed = [
        ["first_contact_median", "contact_p50"],
        ["first_contact_p75", "contact_p75"],
        ["first_contact_p90", "contact_p90"],
        ["owner_wait_median", "wait_p50"],
        ["owner_wait_p75", "wait_p75"],
        ["owner_wait_p90", "wait_p90"],
      ] as const;
      for (const [name, field] of timed) {
        const v = num(g[field]);
        if (v !== null) add(`${base}.${field}`, `${lab}: ${name.replace(/_/g, " ")}`, formatMinutes(v), v, href, view, name);
      }
    } else if (ctx.key === "visa_to_enrolled") {
      const won = g.won_not_enrolled ?? 0;
      const enrolled = g.moved_to_enrolled ?? 0;
      add(`${base}.moved`, `${lab}: visa-approved students moved to Enrolled`, `${fmtN(enrolled)} of ${fmtN(enrolled + won)}`, enrolled, null, view, "moved_to_enrolled");
    } else if (ctx.key === "dropping_a_student") {
      add(`${base}.dropped`, `${lab}: students dropped`, fmtN(g.dropped ?? 0), g.dropped ?? 0, null, view, "dropped");
    }
    groups.push(view);
  }
  return { facts, groups, total: null };
}

/** Metrics whose denominator is the new-lead cohort, so their leads link opens exactly that denominator. */
const COHORT_METRICS = new Set(["arrived", "first_contact_1h_pct", "first_contact_1wh_pct", "reached_qualified_pct"]);

export interface StepRead {
  stepKey: string;
  title: string;
  who: string[];
  metric: string;
  metricLabel: string;
  value: Fact;
  target: Fact;
  status: ReturnType<typeof stepStatus>;
}

/** The live spec's steps against the 30-day numbers, as facts (the same readMetric / stepStatus the pages use). */
export function stepReads(key: ProcessKey, spec: ProcessSpec, raw: RawMetrics, w: ImproverWindow, listIds: readonly string[]): StepRead[] {
  return spec.steps.map((s) => {
    const m = readMetric(key, s.target.metric, raw);
    const unit = METRIC_REGISTRY[key][s.target.metric]?.unit ?? s.target.unit;
    const href = COHORT_METRICS.has(s.target.metric) ? cohortHref(w, listIds) : null;
    const frac = m?.fraction ? `${fmtN(m.fraction.n)} of ${fmtN(m.fraction.d)}` : null;
    const shown = fmtValue(m?.value ?? null, unit);
    const value: Fact = {
      id: `step.${s.key}.value`,
      label: `${s.title}: ${m?.label ?? s.target.metric}`,
      display: frac && unit === "percent" && m?.value != null ? `${shown} (${frac})` : shown,
      raw: m?.value ?? null,
      href,
      stepKey: s.key,
    };
    const target: Fact = { id: `step.${s.key}.target`, label: `${s.title}: target`, display: `${s.target.op === ">=" ? "at least" : "at most"} ${fmtValue(s.target.value, unit)}`, raw: s.target.value, href: null, stepKey: s.key };
    return { stepKey: s.key, title: s.title, who: s.who, metric: s.target.metric, metricLabel: m?.label ?? s.target.metric, value, target, status: stepStatus(m?.value ?? null, s.target.op, s.target.value) };
  });
}

/** A process "needs improving" when at least one step with data is not on target. No data anywhere = nothing to judge. */
export const needsImprovement = (reads: readonly Pick<StepRead, "status">[]): boolean => reads.some((r) => r.status === "amber" || r.status === "red");
