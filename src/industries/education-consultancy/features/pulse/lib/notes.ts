import { activityOf, type PersonRow } from "./types";

/**
 * At most ONE row note per person, from the rule signals (never guessed): activity drop → "check in first",
 * over capacity → the intake multiple, top mover → the delivered count. Null when nothing applies.
 */
export function rowNote(p: PersonRow): { kind: "red" | "amber" | "green"; text: string } | null {
  const usualAct = activityOf(p.usual);
  if (p.flag === "red" && usualAct > 0) {
    return { kind: "red", text: `Activity ${Math.round((activityOf(p.current) / usualAct) * 100)}% of usual · check in first` };
  }
  if (p.flag === "amber" && p.usual.received > 0) {
    return { kind: "amber", text: `Over capacity · ${(Math.round((p.current.received / p.usual.received) * 10) / 10).toString()}× intake` };
  }
  if (p.flag === "green") {
    const metric = p.current.reached_applications - p.usual.reached_applications > 0 ? "reached_applications" : "prospects";
    return { kind: "green", text: `Top mover · ${p.current[metric]} ${metric === "reached_applications" ? "to Applications" : "to Prospects"}` };
  }
  return null;
}

/** The person view's coaching note: only the person's own numbers, no guesses about why. */
export function coachingNote(p: PersonRow): string | null {
  const parts: string[] = [];
  const add = (label: string, cur: number, usual: number) => {
    if (usual >= 5 || cur >= 5) parts.push(`${label} ${cur} vs usual ${Math.round(usual)}`);
  };
  add("calls", p.current.calls, p.usual.calls);
  add("notes", p.current.notes, p.usual.notes);
  add("stage moves", p.current.moves, p.usual.moves);
  if (parts.length === 0) return null;
  const act = activityOf(p.current), usual = activityOf(p.usual);
  const lead = usual >= 10 && act <= usual * 0.6
    ? `${p.name}'s activity is at ${Math.round((act / usual) * 100)}% of usual.`
    : usual >= 10 && act >= usual * 1.25
      ? `${p.name}'s activity is ${Math.round((act / usual - 1) * 100)}% above usual.`
      : `${p.name}'s activity is in line with usual.`;
  return `${lead} ${parts.join(" · ")}.`;
}

export function windowTitle(key: string, tenantShort: string, range: string): string {
  const at = tenantShort ? ` at ${tenantShort}` : "";
  if (key === "24h") return `Today${at}`;
  if (key === "7d") return `This week${at}`;
  if (key === "30d") return `Last 30 days${at}`;
  return `${range}${at}`;
}
