import type { DoNextItem } from "./types";
import type { CurrentRecord } from "./note-extract";

/**
 * B4: Call prep (H3c). Before a first call: what we know (shown as it is, no AI), what is missing on the record, an opening line,
 * and, only on a real match, a fact from the company's own knowledge base with its source. The counsellor never goes in cold.
 */

/** "Call prep" sits next to "Call" on new-lead rows. */
export function callPrepEligible(item: Pick<DoNextItem, "kind" | "leadId" | "primaryAction">): boolean {
  return item.kind === "new_uncalled" && !!item.leadId && item.primaryAction.type === "call";
}

/**
 * The phone as H3c shows it: "+977 98•• ••• 412". The full number never reaches the panel (the Call button already holds it).
 * Local part = the last 10 digits; anything in front is the country code.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (d.length < 7) return d.length ? "•••" : null;
  const local = d.length > 10 ? d.slice(-10) : d;
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : "";
  return `${cc ? `+${cc} ` : ""}${local.slice(0, 2)}•• ••• ${local.slice(-3)}`;
}

export interface AskAbout {
  key: "english_test" | "decision_maker" | "budget" | "country" | "intake" | "course" | "qualification";
  label: string;
}

/**
 * "Ask about (missing on the record)": ONLY the fixed list Orca can fill from a note (B1), and only what is empty on this lead.
 * The same list on both sides, so everything asked about on the call is something the one note afterwards can fill in.
 */
export function askAbout(r: CurrentRecord): AskAbout[] {
  const empty = (k: keyof CurrentRecord) => !(r[k] ?? "").trim();
  const out: AskAbout[] = [];
  if (empty("ielts_score") && empty("english_test_plan")) out.push({ key: "english_test", label: "IELTS / PTE plan" });
  if (empty("sponsor_name") && empty("sponsor_relationship")) out.push({ key: "decision_maker", label: "Who decides" });
  if (empty("budget")) out.push({ key: "budget", label: "Budget" });
  if (empty("destinations")) out.push({ key: "country", label: "Country" });
  if (empty("intake_term")) out.push({ key: "intake", label: "Intake" });
  if (empty("field_of_study")) out.push({ key: "course", label: "Course" });
  if (empty("plus_two_gpa") && empty("bachelor_gpa") && empty("masters_gpa")) out.push({ key: "qualification", label: "Highest qualification" });
  return out;
}

export interface KnownRow {
  k: string;
  v: string;
}

/** Custom-field keys never shown (contact details, documents, tokens): the panel shows form answers, not secrets. */
const HIDDEN_KEY = /phone|mobile|email|passport|document|file|url|link|token|password|ref_code|idempotency/i;
const MAX_ANSWER_CHARS = 120;
const MAX_ANSWER_ROWS = 6;

const titleCase = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export interface KnownInput {
  destinations: string[];
  intakeTerm: string | null;
  fieldOfStudy: string | null;
  plusTwoStream: string | null;
  plusTwoGpa: string | null;
  bachelorGpa: string | null;
  mastersGpa: string | null;
  ieltsScore: string | null;
  customFields: Record<string, unknown> | null;
  /** Keys already shown by a row above (or promoted to a column), so a form answer isn't listed twice. */
  shownKeys?: string[];
}

const PROMOTED = new Set(["interested_country", "intake", "intake_term", "field_of_study", "countries", "destination", "degree_level", "education_level", "stream"]);

/**
 * "What we know": the record and the form answers AS THEY ARE, no AI. Wants / Studied / English test, then up to 6 more form answers
 * (custom fields) that are short text. "none on record" for the English test, as in H3c.
 */
export function knownRows(i: KnownInput): KnownRow[] {
  const rows: KnownRow[] = [];
  const wants = [i.fieldOfStudy, i.destinations.join(", "), i.intakeTerm].map((x) => (x ?? "").trim()).filter(Boolean);
  if (wants.length) rows.push({ k: "Wants", v: wants.join(" · ") });
  const gpa = i.bachelorGpa || i.mastersGpa || i.plusTwoGpa;
  const studied = [i.plusTwoStream ? `+2 ${i.plusTwoStream}` : "", gpa ? `GPA ${gpa}` : ""].filter(Boolean);
  if (studied.length) rows.push({ k: "Studied", v: studied.join(" · ") });
  rows.push({ k: "English test", v: (i.ieltsScore ?? "").trim() || "none on record" });
  const extra: KnownRow[] = [];
  for (const [key, raw] of Object.entries(i.customFields ?? {})) {
    if (HIDDEN_KEY.test(key) || (i.shownKeys ?? []).includes(key)) continue;
    const v = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    if (!v || v.length > MAX_ANSWER_CHARS) continue;
    if (PROMOTED.has(key) && rows.some((r) => r.v.toLowerCase().includes(v.toLowerCase()))) continue;
    extra.push({ k: titleCase(key), v });
    if (extra.length === MAX_ANSWER_ROWS) break;
  }
  return [...rows, ...extra];
}

/**
 * Knowledge base: shown ONLY on a real match. The hybrid search fuses a vector arm (which always returns its 24 nearest, relevant or
 * not) with a keyword arm by reciprocal rank (k = 60): a chunk found by one arm alone can never score above 1/61 = 0.0164, while a chunk
 * found by BOTH scores at least 2/84 = 0.0238. So 0.02 means "the keyword search AND the vector search both found it". A keyword-only
 * fallback (score 0) never qualifies.
 */
export const KB_MIN_SCORE = 0.02;

export interface KbChunkLite {
  content: string;
  score: number;
  title: string;
  page?: number;
}

export function pickKbChunk(chunks: KbChunkLite[], degraded: boolean): KbChunkLite | null {
  if (degraded) return null;
  return [...chunks].filter((c) => c.score >= KB_MIN_SCORE && c.content.trim()).sort((a, b) => b.score - a.score)[0] ?? null;
}

/** What the knowledge base is asked: the lead's course and country (never a phone, email or name). Empty = no search at all. */
export function kbQuery(i: Pick<KnownInput, "fieldOfStudy" | "destinations">): string {
  return [i.fieldOfStudy, ...i.destinations].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
}
