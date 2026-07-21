import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("ACTIVE_PROVIDER resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    vi.resetModules();
  });

  it("defaults to openai when AI_PROVIDER is unset — no key-presence sniffing", async () => {
    delete process.env.AI_PROVIDER;
    // Presence of ANTHROPIC_API_KEY must not change provider selection on its own.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { ACTIVE_PROVIDER } = await import("./models");
    expect(ACTIVE_PROVIDER).toBe("openai");
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("resolves to anthropic when AI_PROVIDER=anthropic", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const { ACTIVE_PROVIDER } = await import("./models");
    expect(ACTIVE_PROVIDER).toBe("anthropic");
  });

  it("resolves to openai when AI_PROVIDER=openai", async () => {
    process.env.AI_PROVIDER = "openai";
    const { ACTIVE_PROVIDER } = await import("./models");
    expect(ACTIVE_PROVIDER).toBe("openai");
  });

  it("throws loudly on an invalid AI_PROVIDER value", async () => {
    process.env.AI_PROVIDER = "gemini";
    await expect(import("./models")).rejects.toThrow(/Invalid AI_PROVIDER/);
  });
});
