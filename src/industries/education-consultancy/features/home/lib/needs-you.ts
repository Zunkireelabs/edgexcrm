import { encodeFilterTree } from "@/lib/filters/serialize";
import type { AttentionItem } from "../../pulse/lib/types";
import type { ReassignPlan } from "../../pulse/lib/suggest";
import type { NudgeState } from "./nudge";
import type { Tone } from "./types";

export type NeedsAction =
  | { type: "link"; label: string; href: string; primary?: boolean }
  | { type: "nudge"; label: string; userId: string; userName: string }
  | { type: "assign"; label: string; leadIds: string[]; assignments: Array<{ userId: string; name: string; take: number }>; primary?: boolean }
  | { type: "note"; label: string }
  /** Clear the call-back reminders older than 2 weeks (confirm shows `count`). */
  | { type: "clear_stale"; label: string; count: number }
  /** Auto-assignment FYI: put these decisions' leads back to unassigned. */
  | { type: "undo_assignment"; label: string; decisionIds: string[] };

export interface NeedsYouRow {
  key: string;
  tone: Tone;
  icon: "user-plus" | "trend-down" | "file-x" | "bell" | "list-checks" | "user-switch" | "phone-x" | "snowflake";
  title: string;
  chip: { text: string; tone: Tone } | null;
  why: string;
  actions: NeedsAction[];
}

export const NEEDS_YOU_LIMIT = 3;

const TONE: Record<string, Tone> = { bad: "bad", warn: "warn", good: "good", info: "neutral" };

/**
 * Pulse's own attention items (the 7-day window, in Pulse's order), top 3. Nothing is re-derived: the row is a
 * re-skin of `buildAttention`'s output so Home and Pulse can never disagree. A person-shaped item (an activity drop)
 * also offers "Nudge <first name>" unless a nudge is already out / returning.
 */
export function attentionRows(
  items: AttentionItem[],
  nudgeByPerson: ReadonlyMap<string, NudgeState>,
  /** The signed-in person: never the subject of their own Needs-you row, and never offered a nudge to themselves. */
  selfId: string,
  limit = NEEDS_YOU_LIMIT,
): NeedsYouRow[] {
  return items
    .filter((a) => a.category === "needs_action")
    .filter((a) => !isAboutPerson(a, selfId))
    .slice(0, limit)
    .map((a): NeedsYouRow => {
      const personId = a.links.find((l) => l.personId)?.personId ?? a.action?.personId ?? null;
      const person = personId && a.icon === "down" ? { id: personId, first: a.subject.trim().split(/\s+/)[0] || a.subject } : null;
      const nudge = person ? nudgeByPerson.get(person.id) : undefined;
      const actions: NeedsAction[] = [];
      const reassign: NeedsAction | null = a.action && a.action.href ? { type: "link", label: a.action.label, href: a.action.href, primary: !person } : null;
      let chip: NeedsYouRow["chip"] = a.figure ? { text: `${a.figure.strong ? `${a.figure.strong}` : ""}${a.figure.text}`.trim(), tone: TONE[a.tone] ?? "neutral" } : null;
      let title = a.subject;
      if (nudge?.kind === "returned") {
        title = `${a.subject} · nudged ${nudge.when}, still ${nudge.still}`;
        chip = { text: `Still ${nudge.still} untouched`, tone: "bad" };
        if (reassign) actions.push({ ...reassign, primary: true });
      } else if (nudge?.kind === "today") {
        chip = { text: "Nudged today", tone: "neutral" };
        if (reassign) actions.push(reassign);
        actions.push({ type: "note", label: "Nudged today" });
      } else {
        if (person) actions.push({ type: "nudge", label: `Nudge ${person.first}`, userId: person.id, userName: a.subject });
        if (reassign) actions.push(reassign);
        if (!person && !reassign && a.links[0]?.href) actions.push({ type: "link", label: a.links[0].label, href: a.links[0].href });
      }
      return {
        key: `attn:${a.id}`,
        tone: TONE[a.tone] ?? "neutral",
        icon: a.icon === "down" ? "trend-down" : a.icon === "clock" ? "user-plus" : "trend-down",
        title,
        chip,
        why: a.what,
        actions,
      };
    });
}

/** Does this Pulse item name `userId` as its subject (any of its person links)? */
export function isAboutPerson(a: AttentionItem, userId: string): boolean {
  return a.links.some((l) => l.personId === userId) || a.action?.personId === userId;
}

/** A nudge whose person Pulse no longer flags still returns while their leads are untouched. */
export function standaloneNudgeRow(name: string, userId: string, still: number, when: string, leadsHref: string): NeedsYouRow {
  return {
    key: `nudge:${userId}`,
    tone: "bad",
    icon: "bell",
    title: `${name} · nudged ${when}, still ${still}`,
    chip: { text: `Still ${still} untouched`, tone: "bad" },
    why: `${still} of the leads you nudged ${name.trim().split(/\s+/)[0]} about have had no touch since.`,
    actions: [{ type: "link", label: "Reassign", href: leadsHref, primary: true }],
  };
}

export function unassignedRow(args: {
  count: number;
  /** Oldest waiting lead, for "Waiting 14 h". */
  oldestAt: string | null;
  now: Date;
  plan: ReassignPlan;
  /** Up to MAX_ASSIGN_IDS ids, oldest first; null when there are too many to assign in one click. */
  leadIds: string[] | null;
  chooseHref: string;
  /**
   * The live process's assign target (EDGEX-109 P3, T2). `waitMin` is the oldest lead's wait in the process's own minutes (office
   * minutes when its clock is working, else plain minutes). Over the target the row turns red; under it stays blue. Absent = today's
   * plain "Waiting 14 h" in blue.
   */
  target?: { waitMin: number | null; targetMin: number };
}): NeedsYouRow | null {
  const { count: n, plan } = args;
  if (n <= 0) return null;
  const t = args.target && args.target.waitMin !== null ? { wait: args.target.waitMin, target: args.target.targetMin } : null;
  const over = t ? t.wait > t.target : false;
  const waiting = t ? shortWait(t.wait) : args.oldestAt ? waitingLabel(args.now.getTime() - Date.parse(args.oldestAt)) : null;
  const base = {
    key: "unassigned",
    tone: (over ? "bad" : "new") as Tone,
    icon: "user-plus" as const,
    title: `Assign ${n} new ${n === 1 ? "lead" : "leads"}`,
    chip: waiting ? { text: `Waiting ${waiting}${over && t ? ` · target ${t.target} min` : ""}`, tone: (over ? "bad" : "new") as Tone } : null,
  };
  const choose: NeedsAction = { type: "link", label: "Choose…", href: args.chooseHref };
  if (plan.kind === "none") {
    return { ...base, why: "No one with the right role has spare capacity (a +50% cap on their open leads).", actions: [{ type: "link", label: `Review ${n}`, href: args.chooseHref, primary: true }] };
  }
  const assignments =
    plan.kind === "one"
      ? [{ userId: plan.target.userId, name: plan.target.name, take: n }]
      : plan.targets.map((t) => ({ userId: t.person.userId, name: t.person.name, take: t.take }));
  const why = `Suggested: ${assignments.map((a) => `${a.name} +${a.take}`).join(", ")} · they have the most room`;
  const actions: NeedsAction[] = [];
  if (args.leadIds && args.leadIds.length === n) {
    actions.push({ type: "assign", label: "Assign as suggested", leadIds: args.leadIds, assignments, primary: true });
  }
  actions.push(args.leadIds && args.leadIds.length === n ? choose : { ...choose, label: "Choose…" });
  return { ...base, why, actions };
}

/** "12 min", "2 h": a wait in minutes. */
export function shortWait(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 90) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}

function waitingLabel(ms: number): string {
  const h = Math.max(1, Math.round(ms / 3_600_000));
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/** Slice the ids over the plan's targets, in order: Asha takes the first 3, Chirag the next 3. */
export function sliceAssignments(leadIds: string[], assignments: Array<{ userId: string; take: number }>): Array<{ userId: string; ids: string[] }> {
  const out: Array<{ userId: string; ids: string[] }> = [];
  let i = 0;
  for (const a of assignments) {
    const ids = leadIds.slice(i, i + a.take);
    i += a.take;
    if (ids.length) out.push({ userId: a.userId, ids });
  }
  return out;
}

export interface AtRiskApp {
  id: string;
  leadName: string;
  assigneeName: string | null;
  /** "documents missing" detail for the grey line. */
  missingCount: number;
}

/** Applications closing within 7 days with documents missing (A1's deadline_docs verdict), as ONE grouped row. */
export function atRiskRow(apps: AtRiskApp[], href: string): NeedsYouRow | null {
  if (apps.length === 0) return null;
  const names = apps.slice(0, 2).map((a) => (a.assigneeName ? `${a.leadName} (${a.assigneeName.split(/\s+/)[0]})` : a.leadName));
  const rest = apps.length - names.length;
  return {
    key: "at_risk",
    tone: "warn",
    icon: "file-x",
    title: `${apps.length} ${apps.length === 1 ? "application" : "applications"} at risk`,
    chip: { text: "Close within 7 days", tone: "warn" },
    why: `${names.join(" · ")}${rest > 0 ? ` and ${rest} more` : ""} · documents missing${apps.length > 1 ? " on all" : ""}`,
    actions: [{ type: "link", label: `Open ${apps.length}`, href }],
  };
}

/** Reminders nobody will ever act on (over 2 weeks old): one item for whoever sees the whole scope. */
export function staleCallbacksRow(count: number, scopeLabel: string): NeedsYouRow | null {
  if (count <= 0) return null;
  return {
    key: "stale_callbacks",
    tone: "neutral",
    icon: "phone-x",
    title: `${count} call-back ${count === 1 ? "reminder is" : "reminders are"} over 2 weeks old`,
    chip: null,
    why: `Left over from no-answer calls. They stay on nobody's list, so they only add noise \u00B7 ${scopeLabel}`,
    actions: [{ type: "clear_stale", label: "Clear them", count }],
  };
}

/**
 * Leads someone holds that nobody has contacted for over 2 weeks. Off personal lists (nobody can act on "101 leads going
 * quiet"), so the manager sees it ONCE, grouped by person (the three biggest in the grey line). No bulk action here:
 * reassigning / re-engaging comes later, "Review" just opens the leads list.
 */
export function quietOverRow(total: number, byPerson: Array<{ name: string; count: number }>, scopeLabel: string): NeedsYouRow | null {
  if (total <= 0) return null;
  const top = byPerson.slice(0, 3).map((p) => `${p.name} ${p.count}`);
  const others = byPerson.length - top.length;
  return {
    key: "quiet_over_14",
    tone: "neutral",
    icon: "snowflake",
    title: `${total} ${total === 1 ? "lead" : "leads"} with no contact for over 2 weeks`,
    chip: null,
    why: `${top.join(" \u00B7 ")}${others > 0 ? ` and ${others} more ${others === 1 ? "person" : "people"}` : ""}${top.length ? " \u00B7 " : ""}${scopeLabel}`,
    actions: [{ type: "link", label: "Review", href: "/leads" }],
  };
}

const FORMER_PERSON = "a former team member";

/**
 * Leads in an active list whose holder is no longer on the team: nobody is working them. One row for whoever sees the
 * scope. Not smart assignment (these are mid-application and need a counsellor), so the one action just opens the leads
 * list filtered to exactly these leads, where the existing bulk assign does the work.
 */
export function formerHolderRow(args: {
  total: number;
  /** Stage (lead list) name and how many of the leads sit there. */
  byStage: Array<{ name: string; count: number }>;
  /** Live applications on these leads (0 hides the part). */
  applications: number;
  /** Who held them, name null when that user no longer exists at all. */
  byHolder: Array<{ name: string | null; count: number }>;
  href: string;
}): NeedsYouRow | null {
  const n = args.total;
  if (n <= 0) return null;
  const stages = [...args.byStage].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const holders = [...args.byHolder].sort((a, b) => b.count - a.count);
  const top = holders.slice(0, 2).map((h) => `${h.name ?? FORMER_PERSON} ${h.count}`);
  const rest = holders.length - top.length;
  const parts = [
    stages.map((s) => `${s.name} ${s.count}`).join(" \u00B7 "),
    args.applications > 0 ? `${args.applications} ${args.applications === 1 ? "application" : "applications"}` : "",
    top.length ? `last held by ${top.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}` : "",
  ].filter(Boolean);
  return {
    key: "former_holder",
    tone: "warn",
    icon: "user-switch",
    title: n === 1 ? "1 lead is held by someone who left" : `${n} leads are held by people who left`,
    chip: { text: "Nobody working them", tone: "warn" },
    why: parts.join(" \u00B7 "),
    actions: [{ type: "link", label: `Reassign ${n}`, href: args.href, primary: true }],
  };
}

/** `/leads` on exactly these leads: held by these ex-members AND in the active lists (so the archived ones stay out). */
export function formerHolderHref(holderIds: string[], activeListIds: string[]): string {
  const tree = {
    conjunction: "and" as const,
    conditions: [
      { id: "home:former-holders", field: "assignees", op: "is_any_of" as const, value: holderIds },
      { id: "home:active-lists", field: "stage", op: "is_any_of" as const, value: activeListIds },
    ],
  };
  return `/leads?${new URLSearchParams({ f: encodeFilterTree(tree) }).toString()}`;
}
