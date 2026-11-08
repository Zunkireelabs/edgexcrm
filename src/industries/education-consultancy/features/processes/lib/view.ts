import { defaultPolicy, describeWindow, type ProcessPolicy } from "./policy";
import type { ProcessKey } from "./keys";
import type { StepStatus } from "./metrics";
import type { AssignmentMode } from "../../home/lib/assignment/outcome";

/** Pure helpers behind the Processes pages: names, filters and the rules card. No React, no DB. */

const titleCase = (slug: string) =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** Position slug -> the tenant's own position name. `branch-manager` reads "Manager"; a slug with no position row shows title-cased. */
export function resolvePositionName(slug: string, nameBySlug: ReadonlyMap<string, string>): string {
  if (slug === "branch-manager") return "Manager";
  return nameBySlug.get(slug) ?? titleCase(slug);
}

/** "Manager" -> "Managers", "Lead Executive" -> "Lead Executives". Names already ending in s are left alone. */
export const pluralizeRole = (name: string): string => (/s$/i.test(name) ? name : `${name}s`);

const uniq = (xs: string[]) => [...new Set(xs)];

/** Who does a step, in words. The assign step adds ", by hand" when smart assignment is off. */
export function stepOwners(stepKey: string, who: string[], nameBySlug: ReadonlyMap<string, string>, mode: AssignmentMode): string {
  const names = uniq(who.map((s) => resolvePositionName(s, nameBySlug)));
  const base = names.join(" or ");
  if (stepKey !== "assign") return base;
  return `${base || "Manager"}${mode === "off" ? ", by hand" : ", smart assignment"}`;
}

/** The headline's status decides the filter chips. Needs you = a draft waiting for approval (a baseline, or changes on top of a live version), or a red/amber headline. */
export function needsYou(p: { shown: { status: string } | null; headline: { status: StepStatus } | null; draft?: unknown }): boolean {
  return p.shown?.status === "draft" || !!p.draft || p.headline?.status === "red" || p.headline?.status === "amber";
}

/** On track = live and the headline target is met. */
export function onTrack(p: { shown: { status: string } | null; headline: { status: StepStatus } | null }): boolean {
  return p.shown?.status === "live" && p.headline?.status === "met";
}

export const ASSIGN_MODE_LABEL: Record<AssignmentMode, string> = { off: "by hand", shadow: "smart assignment (shadow)", auto: "smart assignment" };

export interface RuleRow {
  label: string;
  value: string;
}

/**
 * The rules EdgeX really runs, from the policy reader (the live process) plus the tenant's assignment mode. Without a policy these are
 * today's constants. Only one process has live rules: the other three are measured only (see `measuredRules`).
 */
export function liveRules(key: ProcessKey, mode: AssignmentMode, policy?: ProcessPolicy): RuleRow[] | null {
  if (key !== "new_lead_first_call") return null;
  const p = policy ?? defaultPolicy();
  return [
    { label: "Assign within", value: `${p.assignWithinMin} min · ${ASSIGN_MODE_LABEL[mode]}` },
    { label: "First contact", value: describeWindow(p.firstContact.minutes, p.firstContact.clock) },
    { label: "Call-back", value: "on the day booked" },
    { label: "Unreachable", value: `after ${p.unreachableAfterCalls} no-answers` },
    { label: "Decide within", value: `${p.decideWithinDays} days` },
  ];
}

/** The three processes that are measured but do not run anything yet, and the ticket that will make them run. */
export const MEASURED_ONLY_TICKET: Partial<Record<ProcessKey, string>> = { visa_to_enrolled: "EDGEX-105", dropping_a_student: "EDGEX-107", leaver_handover: "EDGEX-108" };

/** Rows from each step's target ("Move to Enrolled: at least 80%"), for a process that runs nothing yet. */
export function measuredRules(steps: Array<{ title: string; target: { op: "<=" | ">="; value: number; unit: string }; targetWords: string | null }>): RuleRow[] {
  return steps.map((s) => ({ label: s.title, value: s.targetWords ?? `${s.target.op === ">=" ? "at least" : "at most"} ${s.target.value}${s.target.unit === "percent" ? "%" : s.target.unit === "min" ? " min" : ""}` }));
}

/** The line under the Rules card. New lead: the sentence that is now true. The others: they are only measured. */
export function rulesFooter(key: ProcessKey, live: boolean): string {
  if (key === "new_lead_first_call") return live ? "Change a rule here (through a new version) and Home, assignment and reminders change with it." : "These are the values EdgeX runs today. Once a version is live, changing a rule here changes Home, assignment and reminders.";
  const t = MEASURED_ONLY_TICKET[key];
  return `Measured only today.${t ? ` ${t} makes it run.` : ""}`;
}

const DAY = 86_400_000;

/** The list meta wording: "reviewed today" / "reviewed 7 Nov"; a draft was never approved. */
export function reviewedText(approvedAtIso: string | null, now: Date = new Date()): string {
  if (!approvedAtIso) return "not approved yet";
  return new Date(approvedAtIso).toDateString() === now.toDateString() ? "reviewed today" : `reviewed ${fmtDay(approvedAtIso)}`;
}

/** "7 Nov" (or "7 Nov 2026"). */
export const fmtDay = (iso: string, withYear = false): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

/** "How Admizz worked, 8 Oct–7 Nov": the 30 days a baseline is written from, ending the day it was created. */
export const writtenFrom = (tenantName: string, createdAtIso: string): string =>
  `How ${tenantName || "your team"} worked, ${fmtDay(new Date(Date.parse(createdAtIso) - 30 * DAY).toISOString())}–${fmtDay(createdAtIso)}`;

/** "Today · next by 7 Dec". A draft was never reviewed. */
export function lastReviewed(approvedAtIso: string | null, reviewDueIso: string | null, now: Date = new Date()): string {
  if (!approvedAtIso) return "Not yet";
  const approved = new Date(approvedAtIso);
  const day = (d: Date) => d.toDateString();
  const first = day(approved) === day(now) ? "Today" : fmtDay(approvedAtIso);
  return reviewDueIso ? `${first} · next by ${fmtDay(reviewDueIso)}` : first;
}

/** Split `**bold**` lead phrases out of a step text. Nothing else is interpreted, so no HTML can get through. */
export function splitBold(text: string): Array<{ text: string; bold: boolean }> {
  const out: Array<{ text: string; bold: boolean }> = [];
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (part) out.push({ text: part, bold: i % 2 === 1 });
  });
  return out;
}
