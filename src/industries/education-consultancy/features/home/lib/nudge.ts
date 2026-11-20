import { localDate, weekdayShort } from "./time";

export interface NudgeRecord {
  id: string;
  toUserId: string;
  leadIds: string[];
  createdAt: string;
  resolvedAt: string | null;
}

export type NudgeState =
  | { kind: "resolved" }
  | { kind: "today" }
  /** Nudged on an earlier day and `still` of the leads are untouched since: the item comes back. */
  | { kind: "returned"; still: number; when: string };

/**
 * A nudge is a promise to look again. Resolved once no named lead is still untouched (or it was stamped resolved).
 * Nudged TODAY (tenant-local date) it only shows "Nudged today". From the next day on, while `stillUntouched` > 0, it
 * returns as "Nudged yesterday, still N" (or "Nudged Mon, still N" after a longer gap).
 * "Untouched" = no call / email / meeting / note since the nudge was sent (the caller computes `stillUntouched`).
 */
export function nudgeState(n: Pick<NudgeRecord, "createdAt" | "resolvedAt">, stillUntouched: number, now: Date, tz: string): NudgeState {
  if (n.resolvedAt || stillUntouched <= 0) return { kind: "resolved" };
  const sent = new Date(n.createdAt);
  const sentDay = localDate(sent, tz);
  const today = localDate(now, tz);
  if (sentDay === today) return { kind: "today" };
  const yesterday = localDate(new Date(now.getTime() - 86_400_000), tz);
  return { kind: "returned", still: stillUntouched, when: sentDay === yesterday ? "yesterday" : weekdayShort(sent, tz) };
}

/** A lead is still untouched by the nudge when nothing touched it after the nudge was sent. */
export function stillUntouchedCount(
  leads: Array<{ id: string; lastTouchedAt: string | null }>,
  nudgeCreatedAt: string,
): number {
  const sent = Date.parse(nudgeCreatedAt);
  return leads.filter((l) => !l.lastTouchedAt || Date.parse(l.lastTouchedAt) < sent).length;
}

export function nudgeMessage(managerName: string, leadCount: number): { title: string; message: string } {
  return {
    title: "A quick nudge about your leads",
    message: `${managerName} asked you to look at ${leadCount} ${leadCount === 1 ? "lead" : "leads"} that haven't had a touch yet.`,
  };
}

/**
 * Who may nudge whom. Only people who see more than their own leads (the leads list's own scope), never themselves, and a
 * branch-pinned (team-scope) manager only people in their branch.
 */
export function canNudge(a: { restrictToSelf: boolean; selfId: string; targetId: string; branchPinned: boolean; branchMemberIds: string[] }): boolean {
  if (a.restrictToSelf || a.selfId === a.targetId) return false;
  return a.branchPinned ? a.branchMemberIds.includes(a.targetId) : true;
}

/** The manager's display name for the notification: their profile name, else the part of their email before the @. */
export function managerDisplayName(names: ReadonlyMap<string, string>, userId: string, email: string | null | undefined): string {
  return names.get(userId)?.trim() || (email ?? "").split("@")[0] || "Your manager";
}
