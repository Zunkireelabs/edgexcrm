import type { CellValues } from "./types";

/**
 * Which roles are NOT part of a scoreboard column (shown "–"). Lives in lib so one test can hold it against
 * person-tiles.ts (a role's drawer tile names what it delivers; its scoreboard column must not be "–").
 */
export const NA_ROLES: Record<string, string[]> = {
  received: [],
  "s-pre": ["app-executive"],
  "s-q": ["app-executive"],
  "s-p": ["app-executive"],
  "s-a": ["app-executive"],
  back: [],
  status: [],
  notes: [],
  calls: [],
  "r-p": ["telecaller", "counsellor", "app-executive"],
  "r-s": ["telecaller", "executive", "app-executive"],
  "r-f": ["telecaller", "executive", "counsellor"],
};

/**
 * A role-less total (team total, a branch group) is the sum of the cells a reader can SEE in that column — people
 * whose role is "–" there contribute nothing — so a total can never exceed what the visible rows add up to.
 */
export function sumVisible<P extends { positionKey: string }>(naRoles: string[], people: P[], valueOf: (p: P) => CellValues): CellValues {
  const out: CellValues = { current: 0, previous: 0, usual: 0 };
  for (const p of people) {
    if (naRoles.includes(p.positionKey)) continue;
    const v = valueOf(p);
    out.current += v.current;
    out.previous += v.previous;
    out.usual += v.usual;
  }
  return out;
}
