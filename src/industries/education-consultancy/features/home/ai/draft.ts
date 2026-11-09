import { generateObject } from "ai";
import { z } from "zod";
import { model, aiRequestProviderOptions } from "@/lib/ai/provider";
import { numbersIn } from "../lib/numbers";
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

export function buildDraftPrompt(p: { channel: DraftChannel; tone: DraftTone; kind: string; facts: string[]; previous: string | null; todayLabel: string; fix?: string[] }): { system: string; prompt: string } {
  const system =
    "You draft ONE message from a counsellor at an education consultancy to a student or lead. A human will read, edit and send it: you never send anything. " +
    "Be warm, plain and specific, and use only the facts given. Do not invent facts, dates, fees, scores or numbers: every number you write must appear in the facts. " +
    "Refer to the lead by first name. Names only: never use he, she, his, her or him about anyone, in English or in Nepali (repeat the name instead of a pronoun), and the same goes for the reason (why) and the follow-up task. " +
    "Introduce the counsellor as 'their first name from the Company' using the Company and counsellor first name in the facts, never 'our office', 'our team' or 'the education team'; if the counsellor name is unknown, do not sign with a name. " +
    "Never say when something happened (yesterday, last week, 'N days ago') unless a fact states that timing; use the timing in the facts exactly. " +
    (p.channel === "whatsapp" ? "Channel: WhatsApp. 2 to 4 short sentences, no subject (subject = null). " : "Channel: email. A subject and a short body. ") +
    `Reason for the message: ${p.kind}. ` +
    (TONE_RULE[p.tone] ? TONE_RULE[p.tone] + " " : "") +
    "Also give one sentence on why this message (why), and one follow-up task for the counsellor (followUp)." +
    (p.fix?.length ? ` Your previous attempt was rejected: ${p.fix.join("; ")}. Write it again without that.` : "");
  const prompt = `Today is ${p.todayLabel}.\nFacts:\n${p.facts.map((x) => `- ${x}`).join("\n")}${p.previous ? `\n\nPrevious message:\n${stripPrivate(p.previous)}` : ""}`;
  return { system, prompt };
}

/**
 * The same guard as Orca's read: a number in the draft (or its reason) must be in the facts it was given (Devanagari digits count as
 * their Latin twins, C2). A draft with a number the facts don't hold is refused, never shown looking plausible.
 */
export function draftNumbersOk(raw: Pick<DraftRaw, "text" | "subject" | "why">, facts: string[]): boolean {
  return badNumbers(raw, facts).length === 0;
}

function badNumbers(raw: Pick<DraftRaw, "text" | "subject" | "why">, facts: string[]): string[] {
  const known = new Set(facts.flatMap(numbersIn));
  return [...new Set([raw.text, raw.subject ?? "", raw.why].flatMap(numbersIn).filter((n) => !known.has(n)))];
}

export interface CheckFailure {
  /** The name logged on the server (never any text). */
  check: "number" | "time_word" | "pronoun";
  /** What the retry tells the model, exactly. Contains the offending word/number, which is the model's own output, not lead data. */
  fix: string;
}

/**
 * Everything a draft must pass before the person sees it, by name: numbers (C2: Devanagari too), time WORDS the facts don't back up
 * (S2), and no he/she/his/her in the text, the reason or the task (S4). Empty = fine.
 */
export function draftChecks(raw: DraftRaw, facts: string[]): CheckFailure[] {
  const texts = [raw.text, raw.subject ?? "", raw.why, raw.followUp.title];
  const out: CheckFailure[] = [];
  const nb = badNumbers(raw, facts);
  if (nb.length) out.push({ check: "number", fix: `the number ${nb.join(", ")} is not in the facts: do not write it, use only numbers from the facts` });
  const tw = unbackedTimeWords(texts, facts);
  if (tw.length) out.push({ check: "time_word", fix: `no '${tw.join("', '")}': no fact says when that happened, so do not say when` });
  if (hasGenderedPronoun(texts)) out.push({ check: "pronoun", fix: "do not use he, she, his, her or him anywhere, including the reason and the task: use the person's name instead" });
  return out;
}

export function draftOk(raw: DraftRaw, facts: string[]): boolean {
  return draftChecks(raw, facts).length === 0;
}

export interface WriteDraftInput { channel: DraftChannel; tone: DraftTone; kind: string; facts: string[]; previous: string | null; todayLabel: string; /** C1: what the previous attempt got wrong. */ fix?: string[] }

export async function writeDraft(p: WriteDraftInput): Promise<{ raw: DraftRaw; usage: { inputTokens?: number; outputTokens?: number } }> {
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

export interface ProducedDraft {
  raw: DraftRaw | null;
  usages: Array<{ inputTokens?: number; outputTokens?: number }>;
  /** Names of the checks that failed on each attempt (no text), for the server log. */
  failed: string[][];
}

/**
 * C1: write a draft, and when a check fails retry ONCE telling the model exactly what was wrong. Only a second failure (or a provider
 * error / timeout on both) is `raw: null`, which the panel shows as "Write your own". Shared by the single Draft panel and B5's batch,
 * so both hold the same bar. `write` is injectable for tests.
 */
export async function produceDraft(p: WriteDraftInput, write: typeof writeDraft = writeDraft): Promise<ProducedDraft> {
  const out: ProducedDraft = { raw: null, usages: [], failed: [] };
  let fix: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { raw, usage } = await write({ ...p, fix });
      out.usages.push(usage);
      const fails = draftChecks(raw, p.facts);
      out.failed.push(fails.map((f) => f.check));
      if (fails.length === 0) {
        out.raw = raw;
        return out;
      }
      fix = fails.map((f) => f.fix);
    } catch {
      out.failed.push(["provider"]);
      if (attempt === 1) break;
      fix = undefined;
    }
  }
  return out;
}
