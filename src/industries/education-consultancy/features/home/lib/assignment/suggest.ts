import { decideAssignment, excludedSummary, type Candidate, type Team } from "./score";
import { deriveLeadSignals } from "./signals";

/** A lead waiting for a first owner, as much of it as the scorer reads. */
export interface SuggestLead {
  id: string;
  created_at: string;
  branch_id: string | null;
  destinations: string[] | null;
}

/**
 * What smart assignment WOULD do with a batch of unassigned leads. Reads only: nothing is written, no decision row is stored.
 * One definition for Home's "Assign N new leads" row and Pulse's untouched-leads row, so the two pages cannot disagree.
 */
export interface NewLeadSuggestion {
  /** Per person, in the order the leads should be handed out. `leadIds` are exactly the leads that person would get. */
  assignments: Array<{ userId: string; name: string; take: number; leadIds: string[] }>;
  placed: number;
  /** Leads nobody can take right now. */
  unplaced: number;
  /** The engine's own words for why the unplaced ones have no taker (null when everything was placed). */
  reason: string | null;
  /** The suggestion could not be computed (a read failed): say so instead of blaming the team. */
  failed?: boolean;
}

export const EMPTY_SUGGESTION: NewLeadSuggestion = { assignments: [], placed: 0, unplaced: 0, reason: null };

/**
 * Run the real decision (`decideAssignment`) lead by lead, oldest first. Each pick is added to that person's held and
 * received-today counts IN MEMORY before the next lead is decided, so the suggestion spreads the way the real run does
 * (Room shrinks, the daily share cap bites). `branchId` pins a branch manager to their own branch's people.
 * Leads nobody can take are left out of `assignments` and counted in `unplaced`.
 */
export function suggestAssignments(leads: SuggestLead[], pool: Candidate[], team: Team, opts: { branchId?: string | null } = {}): NewLeadSuggestion {
  if (leads.length === 0) return EMPTY_SUGGESTION;
  // Own copies: the caller's pool is never mutated.
  const people = (opts.branchId ? pool.filter((c) => c.branchId === opts.branchId) : pool).map((c) => ({ ...c }));
  const byId = new Map(people.map((c) => [c.userId, c]));
  const order: string[] = [];
  const picked = new Map<string, string[]>();
  let unplaced = 0;
  let reason: string | null = null;

  for (const lead of [...leads].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const d = decideAssignment(deriveLeadSignals(lead), people, team);
    const winner = d.pickedUserId ? byId.get(d.pickedUserId) : undefined;
    if (!winner) {
      unplaced += 1;
      reason = d.candidates.length === 0 ? d.why : `${excludedSummary(d.candidates) || "nobody is available"}`;
      continue;
    }
    winner.heldOpen += 1;
    winner.receivedToday += 1;
    if (!picked.has(winner.userId)) order.push(winner.userId);
    picked.set(winner.userId, [...(picked.get(winner.userId) ?? []), lead.id]);
  }

  const assignments = order.map((userId) => ({ userId, name: (byId.get(userId) as Candidate).name, take: (picked.get(userId) as string[]).length, leadIds: picked.get(userId) as string[] }));
  const placed = assignments.reduce((n, a) => n + a.take, 0);
  return { assignments, placed, unplaced, reason: unplaced > 0 ? reason : null };
}

/** The row's sentence for a suggestion that could not place everything: the engine's reason, in plain words. */
export function noTakerSentence(s: NewLeadSuggestion, total: number): string {
  if (s.failed) return "Couldn't work out a suggestion just now. Open them to place by hand.";
  const them = total === 1 ? "it" : "them";
  const r = s.reason ?? "";
  // The engine's pool-empty sentence is already a full sentence.
  if (/^No one is in the first-touch positions/.test(r)) return r;
  return `No one can take ${them} now${r ? ` (${r})` : ""}.`;
}
