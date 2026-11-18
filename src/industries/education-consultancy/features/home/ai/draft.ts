import { generateObject } from "ai";
import { z } from "zod";
import { model, aiRequestProviderOptions } from "@/lib/ai/provider";
import { numbersIn } from "../lib/numbers";
import { hasGenderedPronoun, neutralizePronouns, relativeAge, unbackedTimeWords, type DraftChannel, type DraftTone } from "../lib/draft";
import type { DraftContext } from "../server/draft-context";
import { stripPrivate } from "./privacy";
import { HOME_AI_TIMEOUT_MS } from "./usage";

export const draftSchema = z.object({
  skip: z
    .object({
      reason: z.string().trim().min(1).max(400).describe("One short sentence (under 150 characters) for the counsellor, in plain words of your own: why not to send this message, e.g. 'No plans to study abroad for now'. Do not copy the note's wording or its typos (the quote does that). Use the lead's name at most once, never he or she."),
      quote: z.string().trim().min(1).max(400).describe("The EXACT words from a counsellor note or message that make sending wrong. Copy them, do not rephrase."),
    })
    .nullable()
    .describe("Null when the message should be sent. Set it ONLY when a counsellor note or message shows this message would be wrong or pointless (see the rules); then text and why may be empty."),
  text: z.string().trim().max(1200).describe("The message, ready to send. Empty only when skip is set."),
  subject: z.string().trim().max(150).nullable().describe("Email only. Null for WhatsApp."),
  why: z.string().trim().max(300).describe("One sentence: why this message, using only the facts. Use the lead's name, NEVER he, she, his, her or him. Empty only when skip is set."),
  followUp: z.object({
    title: z.string().trim().max(120).describe("A short task for the counsellor to check back, e.g. 'Check for the bank statement on Thursday'. Say 'Check Aman\'s results', never 'his results': the lead\'s name, never he, she, his, her or him. Empty only when skip is set."),
    inDays: z.number().int().min(1).max(7),
  }),
});
type DraftSchemaOut = z.infer<typeof draftSchema>;
/** `skip` may be left out by callers that build a draft by hand: that is the same as null. */
export type DraftRaw = Omit<DraftSchemaOut, "skip"> & { skip?: DraftSchemaOut["skip"] };

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
  ctx.notes.forEach((n, k) => f.push(`Counsellor note ${k + 1} (${relativeAge(n.at, i.now, i.tz)}): ${neutralizePronouns(n.text, ctx.lead.firstName)}`));
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

export function buildDraftPrompt(p: { channel: DraftChannel; tone: DraftTone; kind: string; facts: string[]; previous: string | null; todayLabel: string; rowKind?: string; fix?: string[]; allowSkip?: boolean }): { system: string; prompt: string } {
  const system =
    "You draft ONE message from a counsellor at an education consultancy to a student or lead. A human will read, edit and send it: you never send anything. " +
    "Be warm, plain and specific, and use only the facts given. Do not invent facts, dates, fees, scores or numbers: every number you write must appear in the facts. " +
    "You are writing TO the lead: say 'you' and 'your' in the message (\"your IELTS\", \"your family\"). Greet with the first name once ('Hi Aman,') and then NEVER use the lead's name again in the message, not even as 'Aman's'. " +
    "Never use he, she, his, her or him about anyone, in English or in Nepali. In the reason (why), the follow-up task and any skip reason (these are for the counsellor, not the lead) use the lead's name instead of a pronoun. " +
    "The counsellor notes below may say he or she. Never copy that. " +
    "Introduce the counsellor as 'their first name from the Company' using the Company and counsellor first name in the facts, never 'our office', 'our team' or 'the education team'; if the counsellor name is unknown, do not sign with a name. " +
    "Never say when something happened (yesterday, last week, 'N days ago') unless a fact states that timing; use the timing in the facts exactly. " +
    (p.channel === "whatsapp" ? "Channel: WhatsApp. 2 to 4 short sentences, no subject (subject = null). " : "Channel: email. A subject and a short body. ") +
    `Reason for the message: ${p.kind}. ` +
    "Never open with a stock line: not 'check in', 'checking in', 'wanted to', 'just wanted', 'I remember', 'I hope you', 'hope you're doing well', 'it's been a while', 'it's been some time', 'since we last', 'how is your decision process going'. Go straight to the one specific fact. " +
    (p.rowKind === "going_quiet"
      ? "This is a check-in, so keep it short: AT MOST 2 sentences after the greeting and under 280 characters. " +
        "Open with just 'Hi <name>, <counsellor> here.' or go straight to the point. " +
        "Take ONE specific fact from this person's last counsellor note or message when there is one (a country, a course, an exam, a date or a person), and make the whole message about it: the single question you end with must name that fact, not a general 'are you still interested'. " +
        "Do NOT use stock closing lines such as 'just reply here', 'happy to help', 'if you have any questions', 'pick up where we left off' or 'feel free to reach out'. No two messages should sound alike. "
      : "") +
    (p.allowSkip
      ? "READ THE NOTES BEFORE WRITING. If a counsellor note or message shows that this message would be wrong or pointless, do not write it: set skip with a one-sentence reason and the EXACT words from the note or message as the quote (leave text and why empty). " +
        "That is the case when the lead already told us no or is not interested, has already moved or enrolled elsewhere or is already abroad (so asking about studying there is pointless), asked not to be contacted, or the note says the number is not on WhatsApp or is wrong or switched off (when the channel is WhatsApp). " +
        "Skip ONLY when the note or message itself says so. A lead who is comparing options, worried about cost, busy, waiting for results or documents, talking it over with family, or just slow to reply is NOT a skip: write the message. Never skip because a lead is quiet or because the notes are old. When in doubt, write the message and set skip to null. "
      : "Always write the message and set skip to null. ") +
    (TONE_RULE[p.tone] ? TONE_RULE[p.tone] + " " : "") +
    "Also give one sentence on why this message (why), and one follow-up task for the counsellor (followUp). " +
    "Pronouns slip into the reason (why), the follow-up task and the skip reason most often. Write 'Aman is waiting for results', never 'Aman is waiting for his results'; write 'Check on Aman\'s IELTS booking', never 'Check his IELTS booking'. The skip reason is plain words of your own (\"No plans to study abroad for now\"), never the note copied. Before you answer, read the message, the reason, the follow-up task and any skip reason once more, and rewrite any that holds he, she, his, her or him. " +
    (p.fix?.length ? ` Your previous attempt was rejected: ${p.fix.join("; ")}. Write it again without that.` : "");
  // Last thing the model reads: the one rule it keeps slipping on, with the lead's own name in it.
  const lead = p.facts.find((f) => f.startsWith("Lead first name: "))?.slice("Lead first name: ".length).trim();
  const reminder = lead ? `\n\nReminder: the message speaks TO ${lead}: say "you" and "your", and write the name ${lead} only in the greeting, never again in the message. In the reason (why), the follow-up task and any skip reason write ${lead} or ${lead}'s, never he, she, his, her or him, not even for the family ("${lead}'s father", not "her father"), and not in a reason like "Rina said she is not interested" (write "Rina is not interested").${p.rowKind === "going_quiet" ? " Do not write 'check in', 'checking in' or 'wanted to' anywhere in the message, and do not work out a new date or number: use only the ones in the facts." : ""}` : "";
  const prompt = `Today is ${p.todayLabel}.\nFacts:\n${p.facts.map((x) => `- ${x}`).join("\n")}${p.previous ? `\n\nPrevious message:\n${stripPrivate(p.previous)}` : ""}${reminder}`;
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
  check: "number" | "time_word" | "pronoun" | "length" | "stock_closing" | "empty" | "skip_quote" | "stock_opening" | "sentences" | "name_repeat" | "skip_reason";
  /** What the retry tells the model, exactly. Contains the offending word/number, which is the model's own output, not lead data. */
  fix: string;
}

/**
 * Everything a draft must pass before the person sees it, by name: numbers (C2: Devanagari too), time WORDS the facts don't back up
 * (S2), and no he/she/his/her in the text, the reason or the task (S4). Empty = fine.
 */
/** P1: a check-in is short and specific. Over this many characters is refused (the prompt asks for under 280). */
export const CHECK_IN_MAX_CHARS = 400;

/** The stock closing lines that made 12 drafts read as one template. A check-in ending with any of them is refused. */
const STOCK_CLOSINGS: RegExp[] = [/just reply here/i, /happy to help/i, /if you have any questions/i, /pick up where we left off/i, /feel free to (?:reach out|ask|contact)/i, /don'?t hesitate/i, /let me know if you (?:need|have|would)/i];

export interface DraftCheckOpts {
  /** Only the batch may answer "don't send"; the single Draft button always gets a message. */
  allowSkip?: boolean;
  /** The row kind. "going_quiet" holds the draft to the check-in rules (length, no stock closing). */
  rowKind?: string;
}

/** Phrases that made 10 check-ins read as one template ("wanted to check in"). A check-in using one is refused. */
const STOCK_OPENINGS: RegExp[] = [
  /\bcheck(?:ing)?[ -]in\b/i, /\bjust wanted\b/i, /\bwanted to (?:check|see|ask|follow|touch|know|make sure)/i,
  /\bI remember\b/i, /\bI hope you\b/i, /\bhope you(?:'|\u2019)?re doing well\b/i, /\bdecision process\b/i,
  /\bit(?:'|\u2019)?s been (?:a while|some time)\b/i, /\bsince we last\b/i,
];

/** The lead's first name, as the facts give it. */
const counsellorNameOf = (facts: string[]) => facts.find((f) => f.startsWith("Counsellor first name: "))?.slice("Counsellor first name: ".length).trim() || null;
const leadNameOf = (facts: string[]) => facts.find((f) => f.startsWith("Lead first name: "))?.slice("Lead first name: ".length).trim() || null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** How many times `name` appears as a word (so "Kristi's" counts). */
function nameCount(text: string, name: string): number {
  return (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "giu")) ?? []).length;
}

/** A check-in is at most this many sentences after the greeting (and the counsellor's "Kamana here." line). */
export const CHECK_IN_MAX_SENTENCES = 2;
/**
 * Sentences in a message after "Hi Name," and a short introduction line. The intro line is skipped ONLY when it holds the counsellor's own
 * first name ("Rita here." / "Rita from Admizz."): "Your offer from Deakin arrived." is a real sentence and counts. No counsellor name in the facts = nothing is skipped.
 */
export function sentencesAfterGreeting(text: string, counsellorFirstName: string | null = null): number {
  let t = text.trim().replace(/^(?:hi|hello|hey|namaste|dear)\s+[^,!.\n]{1,40}[,!.]?\s*/i, "");
  const intro = counsellorFirstName ? /^[^.!?\n]{1,50}\b(?:here|from \w+)\b[^.!?\n]{0,20}[.!]\s*/i.exec(t) : null;
  if (intro && nameCount(intro[0], counsellorFirstName as string) > 0) t = t.slice(intro[0].length);
  return t.split(/[.!?]+(?:\s+|$)/).filter((x) => x.trim().length > 0).length;
}

/** Lower-case, one space, straight quotes: so a quote the model copied matches the note it came from. */
const flat = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim();

/** True when `quote` is, word for word, inside one of the counsellor notes or messages in the facts (never the lead's own record fields). */
export function quoteIsInNotes(quote: string, facts: string[]): boolean {
  const q = flat(quote).replace(/[.!?]+$/, "");
  return q.length > 0 && facts.filter((f) => /^(?:Counsellor note|Message) \d/.test(f)).some((f) => flat(f).includes(q));
}

export function draftChecks(raw: DraftRaw, facts: string[], opts: DraftCheckOpts = {}): CheckFailure[] {
  const out: CheckFailure[] = [];
  if (raw.skip && !opts.allowSkip) return [{ check: "empty", fix: "write the message; do not skip" }];
  if (raw.skip) {
    // "Don't send" is shown to the counsellor with the note's own words, so the words must really be in a note or message, and the reason
    // follows the same no-he/she, no-invented-number rules as a draft.
    if (!quoteIsInNotes(raw.skip.quote, facts)) out.push({ check: "skip_quote", fix: "the quote must be the exact words from a counsellor note or message; if no note rules this message out, write the message instead of skipping" });
    const lead = leadNameOf(facts);
    if (lead && nameCount(raw.skip.reason, lead) > 1) out.push({ check: "skip_reason", fix: `the reason names ${lead} more than once: write it in plain words of your own, e.g. "No plans to study abroad for now"` });
    else if (flat(raw.skip.quote).length >= 12 && flat(raw.skip.reason).includes(flat(raw.skip.quote).replace(/[.!?]+$/, ""))) out.push({ check: "skip_reason", fix: "the reason copies the note: write it in plain words of your own, e.g. \"No plans to study abroad for now\"" });
    if (hasGenderedPronoun([raw.skip.reason])) out.push({ check: "pronoun", fix: "do not use he, she, his, her or him anywhere, including the reason: use the person's name instead" });
    const known = new Set(facts.flatMap(numbersIn));
    const nb = numbersIn(raw.skip.reason).filter((n) => !known.has(n));
    if (nb.length) out.push({ check: "number", fix: `the number ${nb.join(", ")} is not in the facts: do not write it` });
    return out;
  }
  if (!raw.text.trim() || !raw.why.trim() || !raw.followUp.title.trim()) out.push({ check: "empty", fix: "the message, the reason and the follow-up task must all be filled in (leave them empty only when you skip)" });
  const texts = [raw.text, raw.subject ?? "", raw.why, raw.followUp.title];
  const nb = badNumbers(raw, facts);
  if (nb.length) out.push({ check: "number", fix: `the number ${nb.join(", ")} is not in the facts: do not write it, use only numbers from the facts` });
  const tw = unbackedTimeWords(texts, facts);
  if (tw.length) out.push({ check: "time_word", fix: `no '${tw.join("', '")}': no fact says when that happened, so do not say when` });
  // F1: the stock openings are refused for every kind, not only a check-in.
  if (STOCK_OPENINGS.some((re) => re.test(raw.text))) out.push({ check: "stock_opening", fix: "do not open with a stock line ('check in', 'wanted to', 'I remember', 'I hope you', 'it's been a while', 'decision process'): greet with the name, then go straight to the one specific fact" });
  // F2: the message speaks TO the lead, so the lead's name is in the greeting once and nowhere else.
  const lead = leadNameOf(facts);
  if (lead && nameCount(raw.text, lead) > 1) out.push({ check: "name_repeat", fix: `you are writing to ${lead}: use ${lead} only in the greeting, then say "you" and "your", never ${lead}'s or ${lead} again` });
  if (opts.rowKind === "going_quiet") {
    if (raw.text.length > CHECK_IN_MAX_CHARS) out.push({ check: "length", fix: `it is too long (${raw.text.length} characters): at most 2 short sentences, under 280 characters` });
    const nSentences = sentencesAfterGreeting(raw.text, counsellorNameOf(facts));
    if (nSentences > CHECK_IN_MAX_SENTENCES) out.push({ check: "sentences", fix: `it has ${nSentences} sentences after the greeting: write at most 2, the second a single question that names the one fact from the note` });
    if (STOCK_CLOSINGS.some((re) => re.test(raw.text))) out.push({ check: "stock_closing", fix: "do not end with a stock line like 'just reply here', 'happy to help' or 'if you have any questions': end with one concrete question about something specific to this person" });
  }
  if (hasGenderedPronoun(texts)) out.push({ check: "pronoun", fix: "do not use he, she, his, her or him anywhere, including the reason and the task: use the person's name instead" });
  return out;
}

export function draftOk(raw: DraftRaw, facts: string[], opts: DraftCheckOpts = {}): boolean {
  return draftChecks(raw, facts, opts).length === 0;
}

export interface WriteDraftInput { channel: DraftChannel; tone: DraftTone; kind: string; facts: string[]; previous: string | null; todayLabel: string; /** The row kind (reply_waiting, going_quiet, …): check-ins get the short-and-specific rules. */ rowKind?: string; /** C1: what the previous attempt got wrong. */ fix?: string[]; /** Batch only: the model may answer "don't send" (skip) when the notes rule the message out. */ allowSkip?: boolean }

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
      const fails = draftChecks(raw, p.facts, { rowKind: p.rowKind, allowSkip: p.allowSkip });
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
