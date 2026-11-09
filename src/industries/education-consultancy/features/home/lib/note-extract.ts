import { z } from "zod";
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
  field_of_study: { label: "Course", kind: "column", column: "field_of_study" },
  stage: { label: "Stage", kind: "stage" },
} as const;
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
}

/** The record's current values, as text, for the fields above. */
export type CurrentRecord = Partial<Record<NoteField, string>>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const numbersIn = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) ?? [];

/**
 * Turns the model's output into the lines the person ticks. Drops, never repairs:
 *   - a quote that is not in the note (the model made the source up),
 *   - a value with a number that is not in the note (the same guard as Orca's read: no invented numbers),
 *   - a value equal to what is already on the record,
 *   - a stage move when the call log offers no next stage.
 * A note with no facts therefore returns [] and Save still works.
 */
export function sanitizeProposals(raw: NoteExtractRaw["fields"], ctx: { note: string; current: CurrentRecord; nextStageName: string | null }): NoteProposal[] {
  const note = norm(ctx.note);
  const noteNumbers = new Set(numbersIn(ctx.note).map((n) => n.replace(",", ".")));
  const out: NoteProposal[] = [];
  const seen = new Set<NoteField>();
  for (const f of raw) {
    if (seen.has(f.field)) continue;
    if (!note.includes(norm(f.quote))) continue;
    if (!numbersIn(f.to).every((n) => noteNumbers.has(n.replace(",", ".")))) continue;
    let to = f.to.trim();
    if (f.field === "stage") {
      if (!ctx.nextStageName) continue;
      to = ctx.nextStageName;
    }
    const from = ctx.current[f.field] ?? "";
    if (norm(from) === norm(to)) continue;
    if (f.field === "destinations" && from && norm(from).split(", ").includes(norm(to))) continue;
    seen.add(f.field);
    out.push({ field: f.field, label: NOTE_FIELDS[f.field].label, from, to, quote: f.quote.trim() });
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
