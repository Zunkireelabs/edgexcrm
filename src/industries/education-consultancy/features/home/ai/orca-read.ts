import { generateObject } from "ai";
import { model, aiRequestProviderOptions } from "@/lib/ai/provider";
import { readSchema, type Fact, type RawReadPoint, type ReadScope } from "../lib/orca-read";
import { stripPrivate } from "./privacy";
import { HOME_READ_TIMEOUT_MS } from "./usage";

export function buildReadPrompt(scope: ReadScope, facts: Fact[], todayLabel: string): { system: string; prompt: string } {
  const who = scope === "me" ? "a counsellor, about their own day. Speak to them as 'you'." : "an owner or branch manager, about their whole team. Speak about the team by name.";
  const system =
    `You write Orca's read on the Home screen of an education consultancy CRM, for ${who} ` +
    "Return at most 3 points, most useful first. Each point has a claim (one sentence), a reason (one sentence) and the ids of the facts it uses. " +
    "Use ONLY the facts given. Every number you write must be a number that appears in the facts: never add, subtract, estimate or round into a new number. " +
    "If a fact says someone is on leave or a drop is expected, say it is expected, not a problem. " +
    "Refer to every person by their name. Never use he, she, his, her, him or hers: you do not know anyone's gender. " +
    "Facts about the last 7 days are about the last 7 days, not 'this week'. " +
    "If nothing is worth saying, return no points. Plain words, no jargon, no emoji.";
  const prompt = `Today is ${todayLabel}.\nFacts:\n${facts.map((f) => `[${f.id}] ${stripPrivate(f.text)}`).join("\n")}`;
  return { system, prompt };
}

/** model("agent") is for the read only (brief). Throws on provider error, timeout, or output outside the schema. */
export async function writeRead(scope: ReadScope, facts: Fact[], todayLabel: string): Promise<{ points: RawReadPoint[]; usage: { inputTokens?: number; outputTokens?: number } }> {
  const { system, prompt } = buildReadPrompt(scope, facts, todayLabel);
  const { object, usage } = await generateObject({
    model: model("agent"),
    providerOptions: aiRequestProviderOptions(),
    schema: readSchema,
    system,
    prompt,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(HOME_READ_TIMEOUT_MS),
  });
  return { points: object.points, usage };
}
