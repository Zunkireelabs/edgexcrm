import { z } from "zod";
import { stripDecoration } from "@/lib/leads/destination-normalize";
import { numbersIn } from "./numbers";
import { localDate, addDaysStr, tenantLocalToIso } from "./time";

/**
 * B1 (H4): one note fills the record. The model may propose changes ONLY to this fixed list; nothing else can be named.
 * `kind` says where the value lands: a real `leads` column, a `custom_fields` key (merged, never replaced), the
 * destinations array (added to, never replaced), or the stage (only the next one the call log already offers).
 */
export const NOTE_FIELDS = {
  ielts_score: { label: "English test", kind: "column", column: "ielts_score" },
  english_test_plan: { label: "English test plan", kind: "custom", key: "english_test_plan" },
  sponsor_name: { label: "Decision maker", kind: "column", column: "sponsor_name" },
  sponsor_relationship: { label: "Relationship", kind: "column", column: "sponsor_relationship" },
  budget: { label: "Budget", kind: "custom", key: "budget" },
  destinations: { label: "Interested country", kind: "destinations" },
  intake_term: { label: "Intake", kind: "column", column: "intake_term" },
  field_of_study: { label: "Field of study", kind: "column", column: "field_of_study" },
  // F4: the Prospects rule wants ONE gate-eligible level's %/GPA; a call often says it, so one note can fill it and move the stage.
  plus_two_gpa: { label: "Highest qualification: +2 %/GPA", kind: "column", column: "plus_two_gpa" },
  bachelor_gpa: { label: "Highest qualification: Bachelor %/GPA", kind: "column", column: "bachelor_gpa" },
  masters_gpa: { label: "Highest qualification: Masters %/GPA", kind: "column", column: "masters_gpa" },
  stage: { label: "Stage", kind: "stage" },
} as const;

/** Highest level first: if a note gives scores for two levels, only the highest is proposed. */
export const GPA_FIELDS = ["masters_gpa", "bachelor_gpa", "plus_two_gpa"] as const;
export type NoteField = keyof typeof NOTE_FIELDS;
export const NOTE_FIELD_KEYS = Object.keys(NOTE_FIELDS) as [NoteField, ...NoteField[]];

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** What the model returns. An unknown field name fails the whole parse: the model cannot invent fields. */
export const noteExtractSchema = z.object({
  fields: z
    .array(
      z.object({
        field: z.enum(NOTE_FIELD_KEYS),
        to: z.string().trim().min(1).max(200),
        quote: z.string().trim().min(1).max(300).describe("The exact words from the note this came from."),
      }),
    )
    .max(12),
  nextStep: z.object({
    kind: z.enum(["call_back", "office_visit", "none"]),
    day: z.enum(["today", "tomorrow", ...WEEKDAYS]).nullable().describe("When to call back, as the person said it."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("Only if the note names an exact calendar date."),
    part: z.enum(["morning", "afternoon", "evening"]).nullable(),
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable().describe("Only if the note names a clock time, 24 h."),
  }),
});
export type NoteExtractRaw = z.infer<typeof noteExtractSchema>;

export interface NoteProposal {
  field: NoteField;
  label: string;
  /** What is on the record now, as text ("" when empty). */
  from: string;
  to: string;
  quote: string;
  /** What the person reads. Equals `to` except for a country, which is ADDED to the list: "Australia, UK" (no strike-through). */
  shows: string;
  /** Country is added to; every other field replaces. The UI strikes the old value through only when it is replaced. */
  additive?: boolean;
}

/** The record's current values, as text, for the fields above. */
export type CurrentRecord = Partial<Record<NoteField, string>>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();


const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The model returns the MONTH; code adds the year and writes "February 2027" (the real values on the record). A year the note
 * names ("Sept 2027") is kept; otherwise it is the next time that month comes round (this month counts as coming round).
 * Null when no month can be read.
 */
export function intakeWithYear(to: string, quote: string, now: Date, tz: string): string | null {
  const m = to.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  if (!m) return null;
  const idx = MONTH_KEYS.indexOf(m[1]);
  const named = to.match(/\b(20\d{2})\b/)?.[1] ?? quote.match(/\b(20\d{2})\b/)?.[1];
  const [cy, cm] = localDate(now, tz).split("-").map(Number);
  const year = named ? Number(named) : idx + 1 >= cm ? cy : cy + 1;
  return `${MONTHS[idx]} ${year}`;
}

const catalogKey = (s: string) => stripDecoration(s).toLowerCase().replace(/\s+/g, " ").trim();
/** The tenant's own spelling of `value`, or null when it is not on their list. Never rewrites to a hardcoded spelling. */
export function matchCatalog(value: string, list: readonly string[]): string | null {
  const k = catalogKey(value);
  return list.find((x) => catalogKey(x) === k) ?? null;
}

const ROLE_WORDS = new Set([
  "father", "mother", "dad", "mom", "mum", "papa", "mama", "parent", "parents", "uncle", "aunt", "aunty", "brother", "sister", "husband", "wife",
  "guardian", "grandfather", "grandmother", "grandpa", "grandma", "family", "relative", "sponsor", "self", "himself", "herself", "student", "he", "she",
]);
/** R8: "Dad", "his father", "the uncle" name nobody: a role, not a name. */
export function isRoleOnly(value: string): boolean {
  const words = norm(value).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w && !["my", "his", "her", "their", "the", "a", "an", "of"].includes(w));
  return words.length > 0 && words.every((w) => ROLE_WORDS.has(w));
}

export interface SanitizeCtx {
  note: string;
  current: CurrentRecord;
  nextStageName: string | null;
  now: Date;
  tz: string;
  /** The tenant's own lists: their countries and their field-of-study catalog. An answer not on them is dropped. */
  catalogs: { countries: readonly string[]; fieldsOfStudy: readonly string[] };
}

/**
 * Turns the model's output into the lines the person ticks. Drops, never repairs:
 *   - a quote that is not in the note (the model made the source up),
 *   - a value with a number that is not in the note (the same guard as Orca's read: no invented numbers),
 *   - a country or field of study that is not on the tenant's own list (matched case-insensitively, written in THEIR spelling),
 *   - an intake whose month can't be read,
 *   - a value equal to what is already on the record,
 *   - a stage move when the call log offers no next stage.
 * A note with no facts therefore returns [] and Save still works.
 */
export function sanitizeProposals(raw: NoteExtractRaw["fields"], ctx: SanitizeCtx): NoteProposal[] {
  const note = norm(ctx.note);
  const noteNumbers = new Set(numbersIn(ctx.note).map((n) => n.replace(",", ".")));
  const out: NoteProposal[] = [];
  const seen = new Set<NoteField>();
  const gpaKept = GPA_FIELDS.find((g) => raw.some((f) => f.field === g));
  for (const f of raw) {
    if (seen.has(f.field)) continue;
    if ((GPA_FIELDS as readonly string[]).includes(f.field) && f.field !== gpaKept) continue;
    if (!note.includes(norm(f.quote))) continue;
    if (!numbersIn(f.to).every((n) => noteNumbers.has(n.replace(",", ".")))) continue;
    let to = f.to.trim();
    let additive = false;
    let field: NoteField = f.field;
    // R8: Decision maker is a NAME. A role alone ("dad decides") fills Relationship only.
    if (f.field === "sponsor_name" && isRoleOnly(to)) {
      if (raw.some((r) => r.field === "sponsor_relationship")) continue;
      field = "sponsor_relationship";
    }
    if (f.field === "stage") {
      if (!ctx.nextStageName) continue;
      to = ctx.nextStageName;
    } else if (f.field === "intake_term") {
      const t = intakeWithYear(to, f.quote, ctx.now, ctx.tz);
      if (!t) continue;
      to = t;
    } else if (f.field === "destinations") {
      const t = matchCatalog(to, ctx.catalogs.countries);
      if (!t) continue;
      to = t;
      additive = true;
    } else if (f.field === "field_of_study") {
      const t = matchCatalog(to, ctx.catalogs.fieldsOfStudy);
      if (!t) continue;
      to = t;
    }
    const from = ctx.current[field] ?? "";
    if (norm(from) === norm(to)) continue;
    if (additive && from && norm(from).split(", ").includes(norm(to))) continue;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      label: NOTE_FIELDS[field].label,
      from,
      to,
      quote: f.quote.trim(),
      shows: additive && from ? `${from}, ${to}` : to,
      ...(additive ? { additive: true } : {}),
    });
  }
  return out;
}

export const PART_OF_DAY_HOUR = { morning: "10:00", afternoon: "14:00", evening: "17:00" } as const;

/**
 * "call him wed morning" → the instant, in the tenant's zone. A named weekday is the NEXT one strictly after today
 * (saying "Wed" on a Wednesday means next week); "today"/"tomorrow" are relative to the tenant-local date. morning 10:00,
 * afternoon 14:00, evening 17:00; an explicit clock time wins; nothing said → 10:00. A time already past today is not
 * proposed. Null when the note names no day.
 */
export function callbackFromNextStep(step: NoteExtractRaw["nextStep"], now: Date, tz: string): string | null {
  if (step.kind !== "call_back") return null;
  const today = localDate(now, tz);
  let date: string | null = null;
  if (step.date) date = step.date;
  else if (step.day === "today") date = today;
  else if (step.day === "tomorrow") date = addDaysStr(today, 1);
  else if (step.day) {
    const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const target = WEEKDAYS.indexOf(step.day);
    const ahead = ((target - todayDow + 7) % 7) || 7;
    date = addDaysStr(today, ahead);
  }
  if (!date) return null;
  const hhmm = step.time ?? PART_OF_DAY_HOUR[step.part ?? "morning"];
  const iso = tenantLocalToIso(`${date}T${hhmm}`, tz);
  if (!iso || Date.parse(iso) <= now.getTime()) return null;
  return iso;
}

export interface TickedField {
  field: NoteField;
  to: string;
}

/**
 * The PATCH body for the ticked fields. `custom_fields` is a whole-column replace in the PATCH pipeline, so the current
 * object is merged here, never overwritten by a bare `{budget}`. destinations are added to, not replaced. The stage is not
 * here: the call log's own next-stage move carries it.
 */
export function buildFieldPatch(ticked: TickedField[], current: { custom_fields: Record<string, unknown> | null; destinations: string[] | null }): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  let custom: Record<string, unknown> | null = null;
  for (const t of ticked) {
    const def = NOTE_FIELDS[t.field];
    const to = t.to.trim().slice(0, 200);
    if (!to) continue;
    if (def.kind === "column") patch[def.column] = to;
    else if (def.kind === "custom") custom = { ...(custom ?? current.custom_fields ?? {}), [def.key]: to };
    else if (def.kind === "destinations") {
      const have = current.destinations ?? [];
      patch.destinations = have.some((d) => norm(d) === norm(to)) ? have : [...have, to];
    }
  }
  if (custom) patch.custom_fields = custom;
  return patch;
}

/** What one ticked field changed, kept on the ai_drafts row so Undo can put back exactly that and nothing else. */
export interface UndoItem {
  field: NoteField;
  kind: "column" | "custom" | "destinations";
  /** The column name, or the custom_fields key. */
  key: string;
  before: unknown;
  wrote: unknown;
}

type LeadForUndo = {
  custom_fields: Record<string, unknown> | null;
  destinations: string[] | null;
  [column: string]: unknown;
};

/** Called BEFORE the patch is applied, with the lead as it was and the patch buildFieldPatch made. */
export function captureUndo(ticked: TickedField[], lead: LeadForUndo, patch: Record<string, unknown>): UndoItem[] {
  const items: UndoItem[] = [];
  for (const t of ticked) {
    const def = NOTE_FIELDS[t.field];
    if (def.kind === "column" && def.column in patch) items.push({ field: t.field, kind: "column", key: def.column, before: lead[def.column] ?? null, wrote: patch[def.column] });
    else if (def.kind === "custom" && patch.custom_fields) items.push({ field: t.field, kind: "custom", key: def.key, before: lead.custom_fields?.[def.key] ?? null, wrote: (patch.custom_fields as Record<string, unknown>)[def.key] });
    else if (def.kind === "destinations" && patch.destinations) items.push({ field: t.field, kind: "destinations", key: "destinations", before: lead.destinations ?? [], wrote: patch.destinations });
  }
  return items;
}

/**
 * The patch that undoes Orca's fields: each item goes back to `before`, but ONLY if the field still holds what Orca wrote (a
 * later human edit is never overwritten). Custom keys are restored inside the CURRENT custom_fields, so other keys are
 * untouched. The call and the note are never part of it.
 */
export function buildUndoPatch(items: UndoItem[], current: LeadForUndo): { patch: Record<string, unknown>; restored: NoteField[]; skipped: NoteField[] } {
  const patch: Record<string, unknown> = {};
  const restored: NoteField[] = [];
  const skipped: NoteField[] = [];
  let custom: Record<string, unknown> | null = null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const it of items) {
    if (it.kind === "column") {
      if (!same(current[it.key], it.wrote)) { skipped.push(it.field); continue; }
      patch[it.key] = it.before ?? null;
    } else if (it.kind === "custom") {
      if (!same(current.custom_fields?.[it.key], it.wrote)) { skipped.push(it.field); continue; }
      custom = { ...(custom ?? current.custom_fields ?? {}) };
      if (it.before == null) delete custom[it.key];
      else custom[it.key] = it.before;
    } else {
      if (!same(current.destinations ?? [], it.wrote)) { skipped.push(it.field); continue; }
      patch.destinations = it.before ?? [];
    }
    restored.push(it.field);
  }
  if (custom) patch.custom_fields = custom;
  return { patch, restored, skipped };
}
