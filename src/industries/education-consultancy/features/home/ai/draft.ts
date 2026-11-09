import { generateObject } from "ai";
import { z } from "zod";
import { model, aiRequestProviderOptions } from "@/lib/ai/provider";
import { hasGenderedPronoun, relativeAge, unbackedTimeWords, type DraftChannel, type DraftTone } from "../lib/draft";
import type { DraftContext } from "../server/draft-context";
import { stripPrivate } from "./privacy";
import { HOME_AI_TIMEOUT_MS } from "./usage";

export const draftSchema = z.object({
  text: z.string().trim().min(1).max(1200).describe("The message, ready to send."),
  subject: z.string().trim().max(150).nullable().describe("Email only. Null for WhatsApp."),
  why: z.string().trim().min(1).max(300).describe("One sentence: why this message, using only the facts."),
  followUp: z.object({
    title: z.string().trim().min(1).max(120).describe("A short task for the counsellor to check back, e.g. 'Check for the bank statement on Thursday'."),
    inDays: z.number().int().min(1).max(7),
  }),
});
export type DraftRaw = z.infer<typeof draftSchema>;

export interface DraftFactsInput {
  /** The counsellor's first name as Home greets them, or null: then the draft carries no name. Never the email. */
  counsellorFirstName: string | null;
  /** The tenant's short name ("Admizz"): "Rita from Admizz", never "our office" or "the education team". */
  company: string | null;
  now: Date;
  tz: string;
}

/** The facts the model is given, one per line. Phone numbers and emails are NEVER here (and stripPrivate runs again). */
export function draftFacts(ctx: DraftContext, i: DraftFactsInput): string[] {
  const f: string[] = [];
  if (i.company) f.push(`Company: ${i.company}`);
  f.push(i.counsellorFirstName ? `Counsellor first name: ${i.counsellorFirstName}` : "Counsellor name: unknown, so do not sign with a name");
  f.push(`Lead first name: ${ctx.lead.firstName}`);
  if (ctx.lead.destinations.length) f.push(`Interested in studying in: ${ctx.lead.destinations.join(", ")}`);
  if (ctx.lead.intakeTerm) f.push(`Intake: ${ctx.lead.intakeTerm}`);
  if (ctx.lead.fieldOfStudy) f.push(`Field of study: ${ctx.lead.fieldOfStudy}`);
  f.push(ctx.lastCall ? `Last call with the lead: ${relativeAge(ctx.lastCall.at, i.now, i.tz)}${ctx.lastCall.outcome ? ` (${ctx.lastCall.outcome.replace(/_/g, " ")})` : ""}` : "No call with the lead has been logged yet");
  for (const a of ctx.applications) {
    f.push(`Application: ${a.university}, ${a.program}, stage ${a.stageName}${a.deadline ? `, deadline ${a.deadline}${a.daysLeft !== null ? ` (${a.daysLeft} days from today)` : ""}` : ""}`);
    if (a.docsAssessable) f.push(a.missing.length ? `Documents still missing for ${a.university}: ${a.missing.join(", ")}` : `All required documents are in for ${a.university}`);
  }
  ctx.notes.forEach((n, k) => f.push(`Counsellor note ${k + 1} (${relativeAge(n.at, i.now, i.tz)}): ${n.text}`));
  ctx.messages.forEach((m, k) => f.push(`Message ${k + 1} (${m.direction === "inbound" ? "from the lead" : "from the counsellor"}, ${m.channel}, ${relativeAge(m.at, i.now, i.tz)}): ${m.text}`));
  return f.map((x) => stripPrivate(x));
}

const TONE_RULE: Record<DraftTone, string> = {
  new: "",
  retry: "Write a different version from the previous one, same facts.",
  shorter: "Rewrite the previous message shorter, keeping every fact that matters.",
  formal: "Rewrite the previous message in a more formal, respectful tone.",
  nepali: "Rewrite the previous message in Nepali (Devanagari script), natural and polite, keeping names, dates and numbers unchanged.",
};

export function buildDraftPrompt(p: { channel: DraftChannel; tone: DraftTone; kind: string; facts: string[]; previous: string | null; todayLabel: string }): { system: string; prompt: string } {
  const system =
    "You draft ONE message from a counsellor at an education consultancy to a student or lead. A human will read, edit and send it: you never send anything. " +
    "Be warm, plain and specific, and use only the facts given. Do not invent facts, dates, fees, scores or numbers: every number you write must appear in the facts. " +
    "Refer to the lead by first name. Names only: never use he, she, his, her or him about anyone, in English or in Nepali (repeat the name instead of a pronoun), and the same goes for the reason (why) and the follow-up task. " +
    "Introduce the counsellor as 'their first name from the Company' using the Company and counsellor first name in the facts, never 'our office', 'our team' or 'the education team'; if the counsellor name is unknown, do not sign with a name. " +
    "Never say when something happened (yesterday, last week, 'N days ago') unless a fact states that timing; use the timing in the facts exactly. " +
    (p.channel === "whatsapp" ? "Channel: WhatsApp. 2 to 4 short sentences, no subject (subject = null). " : "Channel: email. A subject and a short body. ") +
    `Reason for the message: ${p.kind}. ` +
    (TONE_RULE[p.tone] ? TONE_RULE[p.tone] + " " : "") +
    "Also give one sentence on why this message (why), and one follow-up task for the counsellor (followUp).";
  const prompt = `Today is ${p.todayLabel}.\nFacts:\n${p.facts.map((x) => `- ${x}`).join("\n")}${p.previous ? `\n\nPrevious message:\n${stripPrivate(p.previous)}` : ""}`;
  return { system, prompt };
}

const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
/**
 * The same guard as Orca's read: a number in the draft (or its reason) must be in the facts it was given. A draft with a number
 * the facts don't hold is refused ("Couldn't draft, write your own"), never sent to the person looking plausible.
 */
export function draftNumbersOk(raw: Pick<DraftRaw, "text" | "subject" | "why">, facts: string[]): boolean {
  const known = new Set(facts.flatMap(nums));
  return [raw.text, raw.subject ?? "", raw.why].flatMap(nums).every((n) => known.has(n));
}

/**
 * Everything a draft must pass before the person sees it: numbers (above), time WORDS the facts don't back up (S2: "yesterday",
 * "हिजो", "last week"), and no he/she/his/her anywhere in the text, the reason or the task (S4). Any failure is "Write your own".
 */
export function draftOk(raw: DraftRaw, facts: string[]): boolean {
  const texts = [raw.text, raw.subject ?? "", raw.why, raw.followUp.title];
  return draftNumbersOk(raw, facts) && unbackedTimeWords(texts, facts).length === 0 && !hasGenderedPronoun(texts);
}

export async function writeDraft(p: { channel: DraftChannel; tone: DraftTone; kind: string; facts: string[]; previous: string | null; todayLabel: string }): Promise<{ raw: DraftRaw; usage: { inputTokens?: number; outputTokens?: number } }> {
  const { system, prompt } = buildDraftPrompt(p);
  const { object, usage } = await generateObject({
    model: model("fast"),
    providerOptions: aiRequestProviderOptions(),
    schema: draftSchema,
    system,
    prompt,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(HOME_AI_TIMEOUT_MS),
  });
  return { raw: object, usage };
}
