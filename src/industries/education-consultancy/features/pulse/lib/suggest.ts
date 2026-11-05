import type { PersonRow } from "./types";

/**
 * Who should take the work: the SAME-ROLE person with the lightest load this window (fewest new leads received),
 * excluding the person it is being taken from and anyone who is themselves flagged red (activity drop). Ties break on
 * name so the choice is stable. Null when there is nobody else in that role — the caller must then not name a target.
 */
export function pickLightestLoad(people: PersonRow[], subject: PersonRow): PersonRow | null {
  const pool = people.filter((p) => p.userId !== subject.userId && p.positionKey === subject.positionKey && p.flag !== "red");
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => a.current.received - b.current.received || a.name.localeCompare(b.name))[0];
}
