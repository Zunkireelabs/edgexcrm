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

describe("model() resolves the right vendor and id (no network)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
  });

  it("AI_PROVIDER=anthropic: agent is Sonnet 5.5 and fast is Haiku 5.5, via the Anthropic provider", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { model } = await import("./provider");
    const agent = model("agent") as { modelId: string; provider: string };
    const fast = model("fast") as { modelId: string; provider: string };
    expect(agent.modelId).toBe("claude-sonnet-5-5");
    expect(fast.modelId).toBe("claude-haiku-5-5");
    expect(agent.provider).toMatch(/anthropic/);
  });

  it("AI_PROVIDER=openai (and unset): gpt-4o-mini via OpenAI", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { model } = await import("./provider");
    const agent = model("agent") as { modelId: string; provider: string };
    expect(agent.modelId).toBe("gpt-4o-mini");
    expect(agent.provider).toMatch(/openai/);
  });

  it("request provider options: OpenAI turns storage off, Anthropic sends nothing extra", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const a = await import("./provider");
    expect(a.aiRequestProviderOptions()).toBeUndefined();
    vi.resetModules();
    process.env.AI_PROVIDER = "openai";
    const o = await import("./provider");
    expect(o.aiRequestProviderOptions()).toEqual({ openai: { store: false } });
  });
});
