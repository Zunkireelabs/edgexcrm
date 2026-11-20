import { activityOf, type PersonRow } from "../../pulse/lib/types";

export interface LookRow {
  userId: string;
  name: string;
  initials: string;
  sub: string;
  /** The number Pulse's flag is built on, as Pulse's own Needs-you row prints it: "1 vs usual 31". */
  value: string;
  /** What that number counts: Pulse's own wording for the flag. */
  unit: string;
  tone: "bad" | "warn" | "muted";
}

export interface NeedsALook {
  rows: LookRow[];
  /** "11 others on track": everyone in scope who is neither listed nor the viewer. */
  others: number;
}

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * "Needs a look": only people Pulse's 7-day view flags red (activity drop) or amber (over capacity). Someone on
 * approved leave today is grey with "On leave · expected": a reason, not a problem. The viewer never lists themselves.
 */
export function needsALook(people: PersonRow[], onLeaveToday: ReadonlySet<string>, selfId: string): NeedsALook {
  const others = people.filter((p) => p.userId !== selfId);
  const rows: LookRow[] = [];
  for (const p of others) {
    const flagged = p.flag === "red" || p.flag === "amber";
    if (!flagged) continue;
    const leave = onLeaveToday.has(p.userId);
    // Same measure and same numbers as the flag (pulse/lib/signals.ts): red = activity (calls + notes + stage moves) against
    // the person's usual; amber = new leads received against usual. Never a different metric than the Needs-you row above.
    const red = p.flag === "red";
    const cur = red ? activityOf(p.current) : p.current.received;
    const usual = red ? activityOf(p.usual) : p.usual.received;
    const value = p.hasUsual === false ? String(cur) : `${cur} vs usual ${Math.round(usual)}`;
    const unit = red ? "calls, notes and stage moves" : "new leads";
    rows.push({
      userId: p.userId,
      name: p.name,
      initials: initialsOf(p.name),
      sub: leave ? "On leave · expected" : [p.positionLabel, p.branchName].filter(Boolean).join(" · "),
      value,
      unit,
      tone: leave ? "muted" : p.flag === "red" ? "bad" : "warn",
    });
  }
  // Real concerns first (red, then amber), people on leave last; name breaks ties.
  const order = { bad: 0, warn: 1, muted: 2 } as const;
  rows.sort((a, b) => order[a.tone] - order[b.tone] || a.name.localeCompare(b.name));
  return { rows, others: others.length - rows.length };
}
