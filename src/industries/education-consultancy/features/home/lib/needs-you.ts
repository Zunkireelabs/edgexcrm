import type { AttentionItem } from "../../pulse/lib/types";
import type { ReassignPlan } from "../../pulse/lib/suggest";
import type { NudgeState } from "./nudge";
import type { Tone } from "./types";

export type NeedsAction =
  | { type: "link"; label: string; href: string; primary?: boolean }
  | { type: "nudge"; label: string; userId: string; userName: string }
  | { type: "assign"; label: string; leadIds: string[]; assignments: Array<{ userId: string; name: string; take: number }>; primary?: boolean }
  | { type: "note"; label: string };

export interface NeedsYouRow {
  key: string;
  tone: Tone;
  icon: "user-plus" | "trend-down" | "file-x" | "bell" | "list-checks" | "user-switch";
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
  limit = NEEDS_YOU_LIMIT,
): NeedsYouRow[] {
  return items
    .filter((a) => a.category === "needs_action")
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
}): NeedsYouRow | null {
  const { count: n, plan } = args;
  if (n <= 0) return null;
  const waiting = args.oldestAt ? waitingLabel(args.now.getTime() - Date.parse(args.oldestAt)) : null;
  const base = {
    key: "unassigned",
    tone: "new" as Tone,
    icon: "user-plus" as const,
    title: `Assign ${n} new ${n === 1 ? "lead" : "leads"}`,
    chip: waiting ? { text: `Waiting ${waiting}`, tone: "new" as Tone } : null,
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
