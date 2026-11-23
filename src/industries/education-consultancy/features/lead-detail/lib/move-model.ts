import type { LeadList } from "@/types/database";
import { toLocalDateString } from "@/lib/date";
import { fetchAdjacentLeadId, resolveLeadNav, type LeadNavContext } from "./lead-nav";
import { flattenReadiness } from "../../record-preview/lib/readiness";

/**
 * Pure rules behind the lead-detail flows and confirms (EDGEX-155): what each confirm says, which assignee is
 * preselected, which stages the "Move to…" menu offers, and where the page goes after a hand-off. The dialogs and the
 * hook only render / call these, so each rule is one tested function.
 */

/** Qualify needs at least one study country OR a course (UI-only rule this round; the server rule is EDGEX-158). */
export function canQualify(destinations: readonly string[], course: string): boolean {
  return destinations.length > 0 || course.trim().length > 0;
}

export type MoveDirection = "next" | "back" | "move";

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";

export interface Member { user_id: string; email: string; name?: string | null }
export const memberName = (m: Member) => m.name || m.email.split("@")[0];

/**
 * The assignee a confirm starts on. Never empty while there is anyone to pick: a revert starts on the previous
 * holder (when they are in the list), everything else on the first person of the stage's team.
 */
export function defaultAssignee(members: readonly Member[], direction: MoveDirection, revertTargetUserId: string | null): string {
  if (members.length === 0) return "";
  if (direction === "back" && revertTargetUserId && members.some((m) => m.user_id === revertTargetUserId)) return revertTargetUserId;
  return members[0].user_id;
}

export interface ConfirmCopy {
  title: string;
  body: string;
  /** The stage name inside `body`, shown bold. */
  emphasis: string;
  /** Primary button label for the chosen assignee (or none). */
  button: (assigneeName: string | null) => string;
  tone: "blue" | "amber";
}

/** "Send to Prospects?" / "Move to Qualified?" (step back wording) / "Revert to Pre-qualified?". */
export function confirmCopy(input: { direction: MoveDirection; targetName: string; leadName: string; isBackward: boolean; chainSend: boolean }): ConfirmCopy {
  const { direction, targetName, leadName, isBackward, chainSend } = input;
  if (direction === "back") {
    return { title: `Revert to ${targetName}?`, body: `${leadName} goes back to ${targetName}.`, emphasis: targetName, button: () => "Revert", tone: "amber" };
  }
  if (direction === "next" && chainSend) {
    return {
      title: `Send to ${targetName}?`,
      body: `${leadName} moves to ${targetName} and leaves your list.`,
      emphasis: targetName,
      button: (n) => (n ? `Send to ${firstName(n)}` : "Send"),
      tone: "blue",
    };
  }
  return {
    title: `Move to ${targetName}?`,
    body: `${isBackward ? "This is a step back. " : ""}${leadName} moves to ${targetName}.`,
    emphasis: targetName,
    button: () => "Move",
    tone: "blue",
  };
}

/** A list is a step back when it sits earlier in the funnel than where the lead is now. */
export function isStepBack(from: Pick<LeadList, "sort_order" | "is_archive" | "is_staging"> | null | undefined, to: Pick<LeadList, "sort_order"> | null | undefined): boolean {
  return !!from && !from.is_archive && !from.is_staging && !!to && to.sort_order < from.sort_order;
}

/** The Prospects %/GPA gate shows first when moving FORWARD into Prospects without a qualifying level on file. */
export function needsProspectGate(input: { target: Pick<LeadList, "slug"> | null | undefined; stepBack: boolean; hasQualification: boolean }): boolean {
  return input.target?.slug === "prospects" && !input.stepBack && !input.hasQualification;
}

export interface MoveMenuOption { value: string; label: string; secondary?: string; secondaryTone?: "warn"; disabled?: boolean; slug: string }

/** "Move to…" rows: active stages in funnel order; current = ticked/disabled; Applications disabled with "n missing". */
export function buildMoveMenu(input: {
  chain: readonly Pick<LeadList, "id" | "name" | "slug" | "sort_order">[];
  accessibleIds: ReadonlySet<string>;
  currentListId: string | null;
  readiness: { ready: boolean; missing: string[] } | null;
}): MoveMenuOption[] {
  const { chain, accessibleIds, currentListId, readiness } = input;
  return [...chain]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((l) => accessibleIds.has(l.id) || l.id === currentListId)
    .map((l) => {
      if (l.id === currentListId) return { value: l.id, label: l.name, slug: l.slug, secondary: "Current", disabled: true };
      if (l.slug === "applications" && readiness && !readiness.ready && readiness.missing.length > 0) {
        // Counted like the Highlights card ("Ready to apply"): "Basic info (a, b)" is two fields, not one line.
        return { value: l.id, label: l.name, slug: l.slug, secondary: `${flattenReadiness(readiness.missing).length} missing`, secondaryTone: "warn" as const, disabled: true };
      }
      return { value: l.id, label: l.name, slug: l.slug };
    });
}

export interface HandOffTarget {
  /** Lead to open next, or null = go back to the view. */
  nextId: string | null;
  /** Where "back to the view" goes. */
  href: string;
  /** The nav context to store when the next lead lives on the adjacent page. */
  ctx: LeadNavContext | null;
}

/**
 * After a move that leaves the lead with someone else it is read-only for this user, so the page opens their NEXT lead
 * of the view (`edgex.leadNav`); with none (or no context) it goes back to the view.
 */
export async function resolveHandOffTarget(
  ctx: LeadNavContext | null,
  leadId: string,
  fallbackHref: string,
  fetchAdjacent: typeof fetchAdjacentLeadId = fetchAdjacentLeadId,
): Promise<HandOffTarget> {
  const href = ctx?.href ?? fallbackHref;
  const r = resolveLeadNav(ctx, leadId);
  if (!ctx || !r) return { nextId: null, href, ctx };
  // The next row is on the neighbouring page: fetch it with the view's own query.
  if (!r.nextId && r.hasNext) {
    const adj = await fetchAdjacent(ctx, "next");
    if (adj) return { nextId: adj.id, href, ctx: adj.ctx };
  }
  // Strictly the NEXT lead of the view (no fallback to the previous row): none → back to the view.
  return { nextId: r.nextId, href, ctx };
}

/** "<Name> sent to <assignee> · <Stage>". */
export function handOffToast(leadName: string, assigneeName: string, stageName: string): string {
  return `${leadName} sent to ${assigneeName} · ${stageName}`;
}

/** The lead note an optional revert "Why" becomes, or null when it is blank. */
export function revertNote(why: string): string | null {
  const t = why.trim();
  return t ? t : null;
}

/** Log call "When": past only. "now" (the default) sends no time at all so the server's own clock stands. */
export function whenToIso(local: string, now: Date = new Date()): { iso: string | null; error: string | null } {
  if (!local) return { iso: null, error: null };
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return { iso: null, error: "Enter a valid date and time" };
  if (d.getTime() > now.getTime()) return { iso: null, error: "The time can't be in the future" };
  // Within the last minute is "now": let the server stamp it.
  if (now.getTime() - d.getTime() < 60_000) return { iso: null, error: null };
  return { iso: d.toISOString(), error: null };
}

/**
 * Follow-up task prefill: "Follow up: <first name>", due tomorrow. tasks.due_date is a DATE column, so the mockup's
 * "10:00" cannot be stored without a database change (reported as a deviation); the date is what is prefilled.
 */
export function followUpDefaults(leadName: string, now: Date = new Date()): { title: string; due: string } {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return { title: `Follow up: ${firstName(leadName) || leadName}`, due: toLocalDateString(d) };
}
