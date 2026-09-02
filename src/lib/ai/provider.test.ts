import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("model() provider key-presence guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
  });

  it("unset AI_PROVIDER with OPENAI_API_KEY present resolves via openai — no throw", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-test";
    const { model } = await import("./provider");
    expect(() => model("agent")).not.toThrow();
  });

  it("AI_PROVIDER=anthropic with ANTHROPIC_API_KEY present resolves via anthropic — no throw", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { model } = await import("./provider");
    expect(() => model("agent")).not.toThrow();
  });

  it("AI_PROVIDER=anthropic with ANTHROPIC_API_KEY absent fails loudly — no silent openai fallback", async () => {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test"; // present but must NOT be used as a fallback
    const { model } = await import("./provider");
    expect(() => model("agent")).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("unset AI_PROVIDER with OPENAI_API_KEY absent fails loudly", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const { model } = await import("./provider");
    expect(() => model("agent")).toThrow(/OPENAI_API_KEY is not set/);
  });
});

describe("aiRequestProviderOptions()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    vi.resetModules();
  });

  it("sends store:false on the openai branch so prompts/completions aren't retained in the org's OpenAI logs", async () => {
    delete process.env.AI_PROVIDER; // defaults to openai
    const { aiRequestProviderOptions } = await import("./provider");
    expect(aiRequestProviderOptions()).toEqual({ openai: { store: false } });
  });

  it("returns undefined on the anthropic branch — no equivalent knob, nothing extra sent", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const { aiRequestProviderOptions } = await import("./provider");
    expect(aiRequestProviderOptions()).toBeUndefined();
  });
});
