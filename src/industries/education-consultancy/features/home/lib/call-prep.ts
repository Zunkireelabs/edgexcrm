import type { DoNextItem } from "./types";
import { stripDecoration } from "@/lib/leads/destination-normalize";
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

/** What the FORM already says for a field the record leaves empty, in the tenant's spelling (C4). */
export interface FormHints {
  country?: string;
  course?: string;
}

/**
 * "Ask about (missing on the record)": ONLY the fixed list Orca can fill from a note (B1), and only what is empty on this lead.
 * The same list on both sides, so everything asked about on the call is something the one note afterwards can fill in.
 */
export function askAbout(r: CurrentRecord, hints: FormHints = {}): AskAbout[] {
  const empty = (k: keyof CurrentRecord) => !(r[k] ?? "").trim();
  const out: AskAbout[] = [];
  if (empty("ielts_score") && empty("english_test_plan")) out.push({ key: "english_test", label: "IELTS / PTE plan" });
  if (empty("sponsor_name") && empty("sponsor_relationship")) out.push({ key: "decision_maker", label: "Who decides" });
  if (empty("budget")) out.push({ key: "budget", label: "Budget" });
  if (empty("destinations")) out.push({ key: "country", label: hints.country ? `Country (form says ${hints.country})` : "Country" });
  if (empty("intake_term")) out.push({ key: "intake", label: "Intake" });
  if (empty("field_of_study")) out.push({ key: "course", label: hints.course ? `Course (form says ${hints.course})` : "Course" });
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

export interface Catalogs {
  countries: readonly string[];
  fieldsOfStudy: readonly string[];
  studyLevels: readonly string[];
}

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
  /** The tenant's own lists, so raw form values ("uk", "engineering_technology", "masters") read in the company's spelling (C3). */
  catalogs?: Catalogs;
  /** The company's home country: a study destination list that merely includes it does not show it (C3). */
  homeCountry?: string;
}

/** Loose key for comparing a form value with a catalog entry: case, "_", "-", "&" / "and" and decoration don't matter. */
export function looseKey(s: string): string {
  return stripDecoration(s).toLowerCase().replace(/&/g, " and ").replace(/[_\-/]+/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
}

/** "engineering_technology" -> "Engineering technology": a readable fallback for a value no catalog knows. */
export function prettify(v: string): string {
  const t = v.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** The tenant's own spelling of one value (first catalog that has it), else a readable form of it. */
export function tenantSpelling(value: string, catalogs?: Catalogs): string {
  const k = looseKey(value);
  if (catalogs && k) {
    for (const list of [catalogs.countries, catalogs.fieldsOfStudy, catalogs.studyLevels]) {
      const hit = list.find((x) => looseKey(x) === k);
      if (hit) return hit;
    }
  }
  return prettify(value.trim());
}

const SPLIT = /\s*[,;|\n]+\s*/;
const norm = (s: string) => looseKey(s);

const PROMOTED_FORM_KEYS = new Set(["interested_country", "intake", "intake_term", "field_of_study", "countries", "destination", "degree_level", "education_level", "stream", "program_level", "program_category", "study_destination", "dream_destination", "preferred_study_destination", "country", "preferred_destination", "matched_destination", "select_your_preferred_destination"]);

/** The country the FORM gave, when the record's own destinations are empty (C4); tenant spelling, home country dropped. */
export function formCountry(customFields: Record<string, unknown> | null, catalogs?: Catalogs, home = "Nepal"): string | null {
  for (const key of ["interested_country", "countries", "study_destination", "dream_destination", "preferred_study_destination", "preferred_destination", "matched_destination", "select_your_preferred_destination", "destination", "country"]) {
    const raw = customFields?.[key];
    const parts = (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : typeof raw === "string" ? raw.split(SPLIT) : []).map((x) => x.trim()).filter(Boolean);
    const mapped = [...new Set(parts.map((x) => tenantSpelling(x, catalogs)))].filter((x) => norm(x) !== norm(home));
    if (mapped.length) return mapped.join(", ");
  }
  return null;
}

/** The course the FORM gave (C4), in the tenant's spelling. */
export function formCourse(customFields: Record<string, unknown> | null, catalogs?: Catalogs): string | null {
  for (const key of ["field_of_study", "program_category"]) {
    const raw = customFields?.[key];
    if (typeof raw === "string" && raw.trim()) return tenantSpelling(raw, catalogs);
  }
  return null;
}

/**
 * "What we know": the record and the form answers AS THEY ARE (no AI), in the company's own spelling (C3). Wants / Studied / English
 * test, then up to 6 more short form answers. A form answer that only repeats something already shown (the same country four times
 * under four keys) is left out. "none on record" for the English test, as in H3c.
 */
export function knownRows(i: KnownInput): KnownRow[] {
  const rows: KnownRow[] = [];
  const home = i.homeCountry ?? "Nepal";
  const countries = [...new Set(i.destinations.map((d) => tenantSpelling(d, i.catalogs)))].filter((d) => i.destinations.length === 1 || norm(d) !== norm(home));
  const course = i.fieldOfStudy ? tenantSpelling(i.fieldOfStudy, i.catalogs) : formCourse(i.customFields, i.catalogs);
  const country = countries.length ? countries.join(", ") : formCountry(i.customFields, i.catalogs, home);
  const wants = [course, country, (i.intakeTerm ?? "").trim()].map((x) => (x ?? "").trim()).filter(Boolean);
  if (wants.length) rows.push({ k: "Wants", v: wants.join(" · ") });
  const gpa = i.bachelorGpa || i.mastersGpa || i.plusTwoGpa;
  const studied = [i.plusTwoStream ? `+2 ${i.plusTwoStream}` : "", gpa ? `GPA ${gpa}` : ""].filter(Boolean);
  if (studied.length) rows.push({ k: "Studied", v: studied.join(" · ") });
  rows.push({ k: "English test", v: (i.ieltsScore ?? "").trim() || "none on record" });

  // Everything already shown, as comparable pieces: a form answer made only of these is a repeat.
  const seen = new Set<string>();
  for (const r of rows) for (const part of r.v.split(/\s*(?:·|,)\s*/)) seen.add(norm(part));
  const extra: KnownRow[] = [];
  for (const [key, raw] of Object.entries(i.customFields ?? {})) {
    if (HIDDEN_KEY.test(key)) continue;
    const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").join(", ") : "";
    if (!text || text.length > MAX_ANSWER_CHARS) continue;
    const parts = text.split(SPLIT).map((x) => x.trim()).filter(Boolean);
    const shown = parts.map((x) => tenantSpelling(x, i.catalogs));
    const isHome = (x: string) => PROMOTED_FORM_KEYS.has(key) && norm(x) === norm(home);
    const rowText = rows.map((r) => ` ${norm(r.v)} `);
    const repeats = (x: string) => seen.has(norm(x)) || rowText.some((r) => r.includes(` ${norm(x)} `)) || isHome(x);
    // A form answer made only of things already shown (or of the home country) is not worth a row.
    if (parts.length && parts.every((x, n) => repeats(x) || repeats(shown[n]))) continue;
    const value = shown.join(", ");
    if (extra.some((e) => norm(e.v) === norm(value))) continue;
    extra.push({ k: titleCase(key), v: value });
    for (const x of shown) seen.add(norm(x));
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
