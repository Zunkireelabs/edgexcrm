import { generateObject } from "ai";
import { z } from "zod";
import { model, aiRequestProviderOptions } from "@/lib/ai/provider";
import { hasGenderedPronoun, unbackedTimeWords } from "../lib/draft";
import { numbersIn } from "../lib/numbers";
import { stripPrivate } from "./privacy";
import { HOME_AI_TIMEOUT_MS } from "./usage";

const lineSchema = z.object({ line: z.string().trim().min(1).max(400) });
const kbSchema = z.object({ text: z.string().trim().min(1).max(400).nullable().describe("1 or 2 plain sentences, or null when the passage has nothing useful for this call.") });

const nums = numbersIn;

/** The opening line is held to the same rules as a draft: numbers, time words and he/she are all checked against the facts. */
export function openingOk(line: string, facts: string[]): boolean {
  const known = new Set(facts.flatMap(nums));
  return nums(line).every((n) => known.has(n)) && unbackedTimeWords([line], facts).length === 0 && !hasGenderedPronoun([line]);
}

/** The knowledge-base restatement may only say what the passage says: every number in it must be in the passage. */
export function kbRestatementOk(text: string, passage: string): boolean {
  const known = new Set(nums(passage));
  return nums(text).every((n) => known.has(n)) && !hasGenderedPronoun([text]);
}

export interface OpeningInput {
  company: string | null;
  counsellorFirstName: string | null;
  leadFirstName: string;
  /** Facts already free of contact details (the caller builds them; stripPrivate runs again here). */
  facts: string[];
  todayLabel: string;
}

export function buildOpeningPrompt(i: OpeningInput): { system: string; prompt: string } {
  const system =
    "You write the OPENING LINE a counsellor at an education consultancy will say when they phone a new lead for the first time: one or two short, warm sentences, spoken style. " +
    "Use only the facts given. Do not invent facts, dates, fees, scores or numbers: every number must appear in the facts. " +
    "Introduce the counsellor as 'their first name from the Company' using the Company and counsellor first name in the facts, never 'our office' or 'the education team'; if the counsellor name is unknown, do not give a name. " +
    "Refer to the lead by first name. Names only: never use he, she, his, her or him about anyone. " +
    "Never say when something happened (yesterday, last week) unless a fact states that timing. " +
    "Mention what the lead asked about, then ask if it is a good moment to talk.";
  const lines = [
    ...(i.company ? [`Company: ${i.company}`] : []),
    i.counsellorFirstName ? `Counsellor first name: ${i.counsellorFirstName}` : "Counsellor name: unknown, so do not give a name",
    `Lead first name: ${i.leadFirstName}`,
    ...i.facts,
  ].map((x) => stripPrivate(x));
  return { system, prompt: `Today is ${i.todayLabel}.\nFacts:\n${lines.map((x) => `- ${x}`).join("\n")}` };
}

export async function writeOpening(i: OpeningInput): Promise<{ line: string; usage: { inputTokens?: number; outputTokens?: number } }> {
  const { system, prompt } = buildOpeningPrompt(i);
  const { object, usage } = await generateObject({ model: model("fast"), providerOptions: aiRequestProviderOptions(), schema: lineSchema, system, prompt, maxRetries: 0, abortSignal: AbortSignal.timeout(HOME_AI_TIMEOUT_MS) });
  return { line: object.line, usage };
}

export function buildKbPrompt(p: { passage: string; course: string; country: string }): { system: string; prompt: string } {
  const system =
    "You restate ONE passage from a company's own knowledge base for a counsellor about to phone a lead. Say in one or two plain sentences what the passage says that is useful for a call about the lead's course and country. " +
    "Use ONLY the passage: do not add anything it does not say, and every number you write must be a number in the passage. If the passage has nothing useful for this call, return null.";
  return { system, prompt: `Course: ${stripPrivate(p.course) || "not given"}\nCountry: ${stripPrivate(p.country) || "not given"}\n\nPassage:\n${stripPrivate(p.passage).slice(0, 2500)}` };
}

export async function restateKb(p: { passage: string; course: string; country: string }): Promise<{ text: string | null; usage: { inputTokens?: number; outputTokens?: number } }> {
  const { system, prompt } = buildKbPrompt(p);
  const { object, usage } = await generateObject({ model: model("fast"), providerOptions: aiRequestProviderOptions(), schema: kbSchema, system, prompt, maxRetries: 0, abortSignal: AbortSignal.timeout(HOME_AI_TIMEOUT_MS) });
  return { text: object.text, usage };
}
