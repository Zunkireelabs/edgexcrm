import type { PersonRow } from "./types";

/**
 * Who should take the work: the SAME-ROLE person with the lightest load this window (fewest new leads received),
 * excluding the person it is being taken from and anyone who is themselves flagged — red (activity drop) or amber
 * (over capacity): handing work to someone who is already overloaded or absent is not a suggestion. Ties break on
 * name so the choice is stable. Null when there is nobody else in that role — the caller must then not name a target.
 */
export function pickLightestLoad(people: PersonRow[], subject: PersonRow): PersonRow | null {
  const pool = people.filter((p) => p.userId !== subject.userId && p.positionKey === subject.positionKey && p.flag !== "red" && p.flag !== "amber");
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => a.current.received - b.current.received || a.name.localeCompare(b.name))[0];
}

/** A person may take on at most this share of their CURRENT held load in one move (a +50% cap). */
export const MAX_LOAD_INCREASE = 0.5;

export type ReassignPlan =
  | { kind: "one"; target: PersonRow; held: number }
  | { kind: "split"; targets: Array<{ person: PersonRow; held: number; take: number }> }
  | { kind: "none" };

/**
 * Who can safely absorb `n` leads from `subject`. Candidates are same-role people who are not the subject and carry
 * no over-capacity / activity-drop signal in the WEEKLY view (`flags7d`, whatever window is on screen) nor in the
 * current one. They are ordered by CURRENT held load (open leads they hold now, not intake in the window), and no one
 * takes more than +50% of what they already hold. One person if they can absorb it all, else a split across the
 * lightest few, else `none` (the caller then says "Review N leads" and "no <Role> has spare capacity").
 * `heldLoad` is the source of truth for load: a person missing from it is unknown, hence never a target.
 */
export function planReassign(
  people: PersonRow[],
  subject: PersonRow,
  n: number,
  heldLoad: Record<string, number>,
  flags7d: Record<string, "red" | "amber" | "green">,
): ReassignPlan {
  const pool = people
    .filter((p) => p.userId !== subject.userId && p.positionKey === subject.positionKey)
    .filter((p) => p.flag !== "red" && p.flag !== "amber" && flags7d[p.userId] !== "red" && flags7d[p.userId] !== "amber")
    .filter((p) => heldLoad[p.userId] !== undefined)
    .map((p) => ({ person: p, held: heldLoad[p.userId], cap: Math.floor(heldLoad[p.userId] * MAX_LOAD_INCREASE) }))
    .sort((a, b) => a.held - b.held || a.person.name.localeCompare(b.person.name));
  if (n <= 0) return { kind: "none" };
  const whole = pool.find((c) => c.cap >= n);
  if (whole) return { kind: "one", target: whole.person, held: whole.held };
  const takers: Array<{ person: PersonRow; held: number; take: number }> = [];
  let left = n;
  for (const c of pool) {
    if (left <= 0) break;
    if (c.cap <= 0) continue;
    const take = Math.min(c.cap, left);
    takers.push({ person: c.person, held: c.held, take });
    left -= take;
  }
  return left <= 0 && takers.length > 1 ? { kind: "split", targets: takers } : { kind: "none" };
}
