import { generateObject } from "ai";
import { model, aiRequestProviderOptions } from "@/lib/ai/provider";
import { noteExtractSchema, NOTE_FIELDS, type NoteExtractRaw, type NoteField } from "../lib/note-extract";
import { stripPrivate } from "./privacy";
import { HOME_AI_TIMEOUT_MS } from "./usage";

export interface NoteExtractInput {
  firstName: string;
  note: string;
  /** Today's tenant-local date and weekday, so "wed" and "tomorrow" resolve against the right day. */
  todayLabel: string;
  current: Partial<Record<NoteField, string>>;
  nextStageName: string | null;
  /** The tenant's own lists (F3): the model must choose from them, and anything else is dropped afterwards. */
  catalogs: { countries: readonly string[]; fieldsOfStudy: readonly string[] };
}

export function buildNotePrompt(i: NoteExtractInput): { system: string; prompt: string } {
  const fieldList = (Object.keys(NOTE_FIELDS) as NoteField[])
    .filter((k) => k !== "stage" || i.nextStageName)
    .map((k) => `- ${k}: ${NOTE_FIELDS[k].label}`)
    .join("\n");
  const system =
    "You read a counsellor's call note about an education-consultancy lead and propose changes to the lead's record. " +
    "Use ONLY these fields, and only when the note clearly says the value:\n" + fieldList + "\n" +
    "For each, return the value and the exact words from the note it came from (quote). Never guess, never add a number the note does not contain. " +
    "destinations: choose ONLY from this list, exactly as spelled: " + i.catalogs.countries.map((c) => stripPrivate(c)).join("; ") + ". " +
    "field_of_study: choose ONLY from this list, exactly as spelled: " + i.catalogs.fieldsOfStudy.map((c) => stripPrivate(c)).join("; ") + ". If the note's country or subject is not on its list, leave the field out. " +
    "intake_term: return only the month the note names (for example \"February\"); do not add a year unless the note says one. " +
    "sponsor_name and sponsor_relationship: only when the note says who decides or who pays (for example \"father pays\", \"his uncle is funding\"). A person merely being happy, present or mentioned is not a decision maker. " +
    "plus_two_gpa, bachelor_gpa, masters_gpa: only when the note names BOTH the level and its percentage or GPA; if it gives scores for several levels, return only the highest level. " +
    (i.nextStageName ? `Use field "stage" with any value only if the note says the lead is ready to move on (it will move to "${i.nextStageName}"). ` : "") +
    "Also read the next step: a call-back (say when, as the person said it) or an office visit, else none. " +
    "If the note has no facts for the record, return an empty fields list.";
  const current = (Object.keys(i.current) as NoteField[]).filter((k) => i.current[k]).map((k) => `${k}: ${stripPrivate(i.current[k] as string)}`).join("\n") || "(empty)";
  const prompt = `Today is ${i.todayLabel}.\nLead first name: ${stripPrivate(i.firstName)}\nOn the record now:\n${current}\n\nNote:\n${stripPrivate(i.note)}`;
  return { system, prompt };
}

/** Throws on provider error, timeout, or a result that does not fit the schema: the caller treats any throw as "no proposals". */
export async function extractFromNote(i: NoteExtractInput): Promise<{ object: NoteExtractRaw; usage: { inputTokens?: number; outputTokens?: number } }> {
  const { system, prompt } = buildNotePrompt(i);
  const { object, usage } = await generateObject({
    model: model("fast"),
    providerOptions: aiRequestProviderOptions(),
    schema: noteExtractSchema,
    system,
    prompt,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(HOME_AI_TIMEOUT_MS),
  });
  return { object, usage };
}
