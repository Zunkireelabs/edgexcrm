import { activityOf, type PersonRow } from "./types";
import { weekdayShort } from "./quiet";

/**
 * At most ONE row note per person, from the rule signals (never guessed): activity drop → "check in first",
 * over capacity → the intake multiple, top mover → the delivered count. Null when nothing applies.
 */
export const ROW_NOTE_MAX = 32;
const clip = (t: string) => (t.length > ROW_NOTE_MAX ? `${t.slice(0, ROW_NOTE_MAX - 1).trimEnd()}…` : t);

export function rowNote(p: PersonRow): { kind: "red" | "amber" | "green"; text: string } | null {
  const usualAct = activityOf(p.usual);
  if (p.flag === "red" && usualAct > 0) {
    const text = p.quietSinceDay ? `Quiet since ${weekdayShort(p.quietSinceDay)} · check in first` : `Activity ${Math.round((activityOf(p.current) / usualAct) * 100)}% of usual`;
    return { kind: "red", text: clip(text) };
  }
  if (p.flag === "amber" && p.usual.received > 0) {
    return { kind: "amber", text: clip(`Over capacity · ${(Math.round((p.current.received / p.usual.received) * 10) / 10).toString()}× intake`) };
  }
  if (p.flag === "green") {
    const metric = p.current.reached_applications - p.usual.reached_applications > 0 ? "reached_applications" : "prospects";
    return { kind: "green", text: clip(`Top mover · ${p.current[metric]} ${metric === "reached_applications" ? "to Apps" : "to Prospects"}`) };
  }
  return null;
}

type NoteMetric = "calls" | "notes" | "moves" | "prospects" | "reached_applications" | "applications_filed";
/** The role's own result term (the same one its drawer tile uses). Only metrics that role actually delivers get one. */
function rolePhrase(p: PersonRow, k: NoteMetric, v: number): string {
  const n = p.name;
  if (k === "reached_applications" || k === "prospects" || k === "moves") {
    if (p.positionKey === "counsellor" && k === "reached_applications") return `${n} moved ${v} student${v === 1 ? "" : "s"} to Applications`;
    if (p.positionKey === "executive" && k === "prospects") return `${n} moved ${v} lead${v === 1 ? "" : "s"} to Prospects`;
    if (p.positionKey === "telecaller" && k === "moves") return `${n} moved ${v} lead${v === 1 ? "" : "s"} to Qualified`;
  }
  if (k === "applications_filed" && p.positionKey === "app-executive") return `${n} filed ${v} application${v === 1 ? "" : "s"}`;
  return NOTE_PHRASE[k](n, v);
}
const NOTE_PHRASE: Record<NoteMetric, (n: string, v: number) => string> = {
  calls: (n, v) => `${n} made ${v} call${v === 1 ? "" : "s"}`,
  notes: (n, v) => `${n} wrote ${v} note${v === 1 ? "" : "s"}`,
  moves: (n, v) => `${n} made ${v} stage move${v === 1 ? "" : "s"}`,
  prospects: (n, v) => `${n} moved ${v} lead${v === 1 ? "" : "s"} to Prospects`,
  reached_applications: (n, v) => `${n} moved ${v} student${v === 1 ? "" : "s"} to Applications`,
  applications_filed: (n, v) => `${n} filed ${v} application${v === 1 ? "" : "s"}`,
};
const ACTIVITY: Array<{ key: "calls" | "notes"; word: string }> = [{ key: "calls", word: "calls" }, { key: "notes", word: "notes" }];
const ROLE_RESULT: Record<string, NoteMetric> = { counsellor: "reached_applications", executive: "prospects", "app-executive": "applications_filed", telecaller: "moves" };

/**
 * The person view's read: the most notable signal first (largest change against their own usual, any metric), then
 * the context — calls/notes/moves at their normal level, or the ones that are not. Own numbers only, no guesses.
 */
export function coachingNote(p: PersonRow): string | null {
  const metrics: NoteMetric[] = ["calls", "notes", ROLE_RESULT[p.positionKey] ?? "moves"];
  const ranked = metrics
    .filter((k) => p.usual[k] >= 3 && (p.usual[k] >= 5 || p.current[k] >= 5))
    .map((k) => ({ k, pct: Math.round(((p.current[k] - p.usual[k]) / p.usual[k]) * 100) }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const lead = ranked[0];
  if (!lead) {
    const any = ACTIVITY.some(({ key }) => p.current[key] >= 5) || p.current[ROLE_RESULT[p.positionKey] ?? "moves"] >= 5;
    if (!any) return null;
    return `${p.name} has no usual yet to compare against.`;
  }
  const head = rolePhrase(p, lead.k, p.current[lead.k]) +
    (lead.pct === 0 ? ", in line with usual" : `, ${Math.abs(lead.pct)}% ${lead.pct > 0 ? "above" : "below"} usual`);
  const rest = ACTIVITY.filter(({ key }) => key !== lead.k && (p.usual[key] >= 5 || p.current[key] >= 5));
  const normal = rest.filter(({ key }) => p.usual[key] < 5 || Math.abs((p.current[key] - p.usual[key]) / p.usual[key]) < 0.25);
  const off = rest.filter((r) => !normal.includes(r));
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  let out = head + (normal.length ? `, with ${join(normal.map((n) => n.word))} at their normal level` : "") + ".";
  if (off.length) {
    const t = join(off.map((o) => `${o.word} ${p.current[o.key]} vs usual ${Math.round(p.usual[o.key])}`));
    out += ` ${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  }
  return out;
}

export function windowTitle(key: string, tenantShort: string, range: string): string {
  const at = tenantShort ? ` at ${tenantShort}` : "";
  if (key === "24h") return `Today${at}`;
  if (key === "7d") return `This week${at}`;
  if (key === "30d") return `Last 30 days${at}`;
  return `${range}${at}`;
}
