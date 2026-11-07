import type { PersonRow } from "../../pulse/lib/types";

export interface LookRow {
  userId: string;
  name: string;
  initials: string;
  sub: string;
  value: string;
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
    const calls = p.hasUsual === false ? `${p.current.calls} calls` : `${p.current.calls} / ${Math.round(p.usual.calls)} calls`;
    rows.push({
      userId: p.userId,
      name: p.name,
      initials: initialsOf(p.name),
      sub: leave ? "On leave · expected" : [p.positionLabel, p.branchName].filter(Boolean).join(" · "),
      value: p.flag === "amber" && !leave ? `${p.current.received} new leads` : calls,
      tone: leave ? "muted" : p.flag === "red" ? "bad" : "warn",
    });
  }
  // Real concerns first (red, then amber), people on leave last; name breaks ties.
  const order = { bad: 0, warn: 1, muted: 2 } as const;
  rows.sort((a, b) => order[a.tone] - order[b.tone] || a.name.localeCompare(b.name));
  return { rows, others: others.length - rows.length };
}
