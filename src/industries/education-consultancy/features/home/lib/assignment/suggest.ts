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

/** Can a stored pick still stand? The person's own hard filters only: today's cap and the branch were settled when the pick was made. */
const canStillTake = (c: Candidate) => c.active && !c.onLeave && !c.dormant && c.flag7d !== "red" && c.flag7d !== "amber";

/**
 * Run the real decision (`decideAssignment`) lead by lead, oldest first. Each pick is added to that person's held and
 * received-today counts IN MEMORY before the next lead is decided, so the suggestion spreads the way the real run does
 * (Room shrinks, the daily share cap bites). `branchId` pins a branch manager to their own branch's people.
 * Leads nobody can take are left out of `assignments` and counted in `unplaced`.
 *
 * `storedPicks` (lead id → person) are the engine's open shadow picks. Those leads go to that person first, and count towards their
 * load before the rest are spread, so pressing "Assign as suggested" agrees with what shadow recorded. A pick whose person is no
 * longer in this pool or can no longer take leads is ignored and the lead is spread like the others.
 * `assignments` come back biggest first; ties keep pick order.
 */
export function suggestAssignments(leads: SuggestLead[], pool: Candidate[], team: Team, opts: { branchId?: string | null; storedPicks?: ReadonlyMap<string, string> } = {}): NewLeadSuggestion {
  if (leads.length === 0) return EMPTY_SUGGESTION;
  // Own copies: the caller's pool is never mutated.
  const people = (opts.branchId ? pool.filter((c) => c.branchId === opts.branchId) : pool).map((c) => ({ ...c }));
  const byId = new Map(people.map((c) => [c.userId, c]));
  const order: string[] = [];
  const picked = new Map<string, string[]>();
  let unplaced = 0;
  let reason: string | null = null;

  const give = (person: Candidate, leadId: string) => {
    person.heldOpen += 1;
    person.receivedToday += 1;
    if (!picked.has(person.userId)) order.push(person.userId);
    picked.set(person.userId, [...(picked.get(person.userId) ?? []), leadId]);
  };

  const rest: SuggestLead[] = [];
  for (const lead of [...leads].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const stored = opts.storedPicks?.get(lead.id);
    const person = stored ? byId.get(stored) : undefined;
    if (person && canStillTake(person)) give(person, lead.id);
    else rest.push(lead);
  }

  for (const lead of rest) {
    const d = decideAssignment(deriveLeadSignals(lead), people, team);
    const winner = d.pickedUserId ? byId.get(d.pickedUserId) : undefined;
    if (!winner) {
      unplaced += 1;
      reason = d.candidates.length === 0 ? d.why : `${excludedSummary(d.candidates) || "nobody is available"}`;
      continue;
    }
    give(winner, lead.id);
  }

  const assignments = order
    .map((userId) => ({ userId, name: (byId.get(userId) as Candidate).name, take: (picked.get(userId) as string[]).length, leadIds: picked.get(userId) as string[] }))
    .sort((a, b) => b.take - a.take);
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

/**
 * "Gautam +2, Diplov +2, Kamana +1": a suggestion names people by first name (a full-name list is cut off on the row).
 * People in one suggestion who share a first name keep their full names, so two "Anil"s are never ambiguous.
 * One function for Home's row and Pulse's row, so the two pages read the same.
 */
export function suggestionNames(assignments: ReadonlyArray<{ name: string; take: number }>): string {
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const count = new Map<string, number>();
  for (const a of assignments) count.set(first(a.name).toLowerCase(), (count.get(first(a.name).toLowerCase()) ?? 0) + 1);
  return assignments.map((a) => `${(count.get(first(a.name).toLowerCase()) ?? 0) > 1 ? a.name.trim() : first(a.name)} +${a.take}`).join(", ");
}
