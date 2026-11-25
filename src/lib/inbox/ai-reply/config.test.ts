import { describe, it, expect } from "vitest";
import { aiReplyEnv, aiReplyServerEnabled, parseAiReplyInput, readAiReplyConfig, readNeedsHuman } from "./config";

describe("readAiReplyConfig", () => {
  it("is off for a channel with nothing stored, or odd values", () => {
    expect(readAiReplyConfig(null)).toEqual({ enabled: false, siteId: "" });
    expect(readAiReplyConfig({})).toEqual({ enabled: false, siteId: "" });
    expect(readAiReplyConfig({ website_chat_ai: { enabled: "yes", siteId: 5 } })).toEqual({ enabled: false, siteId: "" });
  });
  it("is only on when it is switched on AND has a site id", () => {
    expect(readAiReplyConfig({ website_chat_ai: { enabled: true, siteId: "admizz-edu" } })).toEqual({ enabled: true, siteId: "admizz-edu" });
    expect(readAiReplyConfig({ website_chat_ai: { enabled: true, siteId: "  " } }).enabled).toBe(false);
  });
  it("does not read the widget settings key", () => {
    expect(readAiReplyConfig({ website_chat: { enabled: true, siteId: "x" } }).enabled).toBe(false);
  });
});

describe("parseAiReplyInput", () => {
  it("accepts on with a site id, and off without one", () => {
    expect(parseAiReplyInput({ enabled: true, siteId: " admizz-edu " })).toEqual({ ok: true, value: { enabled: true, siteId: "admizz-edu" } });
    expect(parseAiReplyInput({ enabled: false, siteId: "" })).toEqual({ ok: true, value: { enabled: false, siteId: "" } });
  });
  it("refuses turning it on without a site id", () => {
    const r = parseAiReplyInput({ enabled: true, siteId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.siteId).toBeDefined();
  });
  it("refuses a bad site id, a non-boolean switch and a non-object body", () => {
    expect(parseAiReplyInput({ enabled: false, siteId: "bad id!" }).ok).toBe(false);
    expect(parseAiReplyInput({ enabled: "true", siteId: "a" }).ok).toBe(false);
    expect(parseAiReplyInput(null).ok).toBe(false);
    expect(parseAiReplyInput([]).ok).toBe(false);
  });
});

describe("aiReplyEnv", () => {
  const ok = { INBOX_AI_REPLY_ENABLED: "true", ZUNKIREE_SEARCH_URL: "https://api.example.com/", ZUNKIREE_SEARCH_KEY: "k" };
  it("needs the flag, the address and the key", () => {
    expect(aiReplyEnv(ok)).toEqual({ url: "https://api.example.com", key: "k" });
    expect(aiReplyEnv({ ...ok, INBOX_AI_REPLY_ENABLED: "false" })).toBeNull();
    expect(aiReplyEnv({ ...ok, ZUNKIREE_SEARCH_URL: "" })).toBeNull();
    expect(aiReplyEnv({ ...ok, ZUNKIREE_SEARCH_KEY: undefined })).toBeNull();
    expect(aiReplyServerEnabled({})).toBe(false);
  });
});

describe("readNeedsHuman", () => {
  it("reads the flag the AI leaves on a chat", () => {
    expect(readNeedsHuman({ needs_human: { at: "2026-11-25T10:00:00Z", reason: "asked_for_person" } })).toEqual({ at: "2026-11-25T10:00:00Z", reason: "asked_for_person" });
    expect(readNeedsHuman({})).toBeNull();
    expect(readNeedsHuman(null)).toBeNull();
    expect(readNeedsHuman({ needs_human: { reason: "x" } })).toBeNull();
  });
});
