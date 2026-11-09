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
