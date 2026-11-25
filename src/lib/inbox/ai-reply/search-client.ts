// Asks the Admizz AI (zunkiree-search) one question and reads its streamed answer.
// Server to server: the shared key goes in X-EdgeX-Key and there is deliberately no Origin header. The visitor's words are
// never logged here.

import { SEARCH_TIMEOUT_MS, type NeedsHumanReason } from "./config";

export interface SearchAnswer {
  answer: string;
  needsHuman: boolean;
  reason: NeedsHumanReason | null;
}

export interface AskInput {
  url: string;
  key: string;
  siteId: string;
  sessionId: string;
  question: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** The `done` event out of a server-sent-event body (lines such as `data: {...}`), or null when the stream never finished. */
export function parseDoneEvent(body: string): SearchAnswer | null {
  let done: Record<string, unknown> | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if (event.type === "done") done = event;
    } catch {
      // a partial or non-JSON line: ignore it
    }
  }
  if (!done) return null;
  const reason = done.needs_human_reason === "asked_for_person" ? "asked_for_person" : done.needs_human_reason === "out_of_knowledge" ? "out_of_knowledge" : null;
  return {
    answer: typeof done.answer === "string" ? done.answer.trim() : "",
    needsHuman: done.needs_human === true,
    reason: done.needs_human === true ? (reason ?? "out_of_knowledge") : null,
  };
}

export async function askSearch(input: AskInput): Promise<SearchAnswer> {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(`${input.url}/api/v1/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-EdgeX-Key": input.key },
    body: JSON.stringify({ site_id: input.siteId, session_id: input.sessionId, question: input.question, channel: "text" }),
    signal: AbortSignal.timeout(input.timeoutMs ?? SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`zunkiree-search answered ${res.status}`);
  const parsed = parseDoneEvent(await res.text());
  if (!parsed) throw new Error("zunkiree-search stream ended without a final answer");
  return parsed;
}
