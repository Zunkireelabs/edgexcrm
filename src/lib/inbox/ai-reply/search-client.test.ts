import { describe, it, expect, vi } from "vitest";
import { askSearch, parseDoneEvent } from "./search-client";

const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

describe("parseDoneEvent", () => {
  it("takes the final answer and ignores cards and tokens", () => {
    const body = sse({ type: "ui_block", block: {} }, { type: "token", data: "Hi" }, { type: "done", answer: " The UK is great. ", needs_human: false, needs_human_reason: null });
    expect(parseDoneEvent(body)).toEqual({ answer: "The UK is great.", needsHuman: false, reason: null });
  });
  it("reads the hand-off signal and its reason", () => {
    expect(parseDoneEvent(sse({ type: "done", answer: "x", needs_human: true, needs_human_reason: "asked_for_person" }))).toMatchObject({ needsHuman: true, reason: "asked_for_person" });
    expect(parseDoneEvent(sse({ type: "done", answer: "x", needs_human: true }))).toMatchObject({ needsHuman: true, reason: "out_of_knowledge" });
  });
  it("is null when the stream never finished, and survives junk lines", () => {
    expect(parseDoneEvent(sse({ type: "token", data: "Hi" }))).toBeNull();
    expect(parseDoneEvent("data: {not json\n\n" + sse({ type: "done", answer: "ok" }))).toMatchObject({ answer: "ok", needsHuman: false });
  });
});

describe("askSearch", () => {
  const input = { url: "https://api.example.com", key: "secret", siteId: "admizz-edu", sessionId: "conv-1", question: "Study in the UK" };

  it("posts to the stream endpoint with the server key, the site, the chat as session, the text channel and NO origin", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(sse({ type: "done", answer: "Yes", needs_human: false }), { status: 200 }));
    const out = await askSearch({ ...input, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.answer).toBe("Yes");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/v1/query/stream");
    expect(init.headers).toMatchObject({ "X-EdgeX-Key": "secret" });
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("origin");
    expect(JSON.parse(init.body)).toEqual({ site_id: "admizz-edu", session_id: "conv-1", question: "Study in the UK", channel: "text" });
  });
  it("throws on an error status or an unfinished stream (so nothing is sent to the visitor)", async () => {
    await expect(askSearch({ ...input, fetchImpl: vi.fn().mockResolvedValue(new Response("no", { status: 429 })) as unknown as typeof fetch })).rejects.toThrow("429");
    await expect(askSearch({ ...input, fetchImpl: vi.fn().mockResolvedValue(new Response(sse({ type: "token", data: "x" }), { status: 200 })) as unknown as typeof fetch })).rejects.toThrow("without a final answer");
  });
});
