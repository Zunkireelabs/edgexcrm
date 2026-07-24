import { describe, it, expect, afterEach } from "vitest";
import { checkDailyBudget, checkAgentDailyBudget } from "./budget";
import type { ScopedClient } from "@/lib/supabase/scoped";

function fakeDb(rows: Array<{ output_tokens: number | null }>, eqCalls: Array<[string, unknown]> = []): ScopedClient {
  const builder = {
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    gte: async () => ({ data: rows }),
  };
  return {
    from: () => ({ select: () => builder }),
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

describe("checkDailyBudget", () => {
  afterEach(() => {
    delete process.env.AI_DAILY_OUTPUT_TOKEN_BUDGET;
  });

  it("flags overBudget once usage meets the configured limit", async () => {
    process.env.AI_DAILY_OUTPUT_TOKEN_BUDGET = "100";
    const db = fakeDb([{ output_tokens: 60 }, { output_tokens: 40 }]);
    const result = await checkDailyBudget(db, "tenant-1");
    expect(result.usedToday).toBe(100);
    expect(result.limit).toBe(100);
    expect(result.overBudget).toBe(true);
  });

  it("is under budget when usage is below the configured limit", async () => {
    process.env.AI_DAILY_OUTPUT_TOKEN_BUDGET = "1000";
    const db = fakeDb([{ output_tokens: 60 }, { output_tokens: null }]);
    const result = await checkDailyBudget(db, "tenant-1");
    expect(result.usedToday).toBe(60);
    expect(result.overBudget).toBe(false);
  });

  it("defaults to the 200k budget when no env override is set", async () => {
    const db = fakeDb([]);
    const result = await checkDailyBudget(db, "tenant-1");
    expect(result.limit).toBe(200_000);
    expect(result.overBudget).toBe(false);
  });

  it("filters ai_usage_events by surface:'assistant'", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const db = fakeDb([], eqCalls);
    await checkDailyBudget(db, "tenant-1");
    expect(eqCalls).toContainEqual(["surface", "assistant"]);
  });
});

describe("checkAgentDailyBudget", () => {
  afterEach(() => {
    delete process.env.AI_AGENT_DAILY_OUTPUT_TOKEN_BUDGET;
  });

  it("filters ai_usage_events by surface:'background_agent' — a separate spend line from the assistant", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const db = fakeDb([], eqCalls);
    await checkAgentDailyBudget(db, "tenant-1");
    expect(eqCalls).toContainEqual(["surface", "background_agent"]);
  });

  it("flags overBudget once agent usage meets AI_AGENT_DAILY_OUTPUT_TOKEN_BUDGET", async () => {
    process.env.AI_AGENT_DAILY_OUTPUT_TOKEN_BUDGET = "50";
    const db = fakeDb([{ output_tokens: 30 }, { output_tokens: 20 }]);
    const result = await checkAgentDailyBudget(db, "tenant-1");
    expect(result.usedToday).toBe(50);
    expect(result.overBudget).toBe(true);
  });

  it("defaults to the 100k agent budget when no env override is set", async () => {
    const db = fakeDb([]);
    const result = await checkAgentDailyBudget(db, "tenant-1");
    expect(result.limit).toBe(100_000);
    expect(result.overBudget).toBe(false);
  });
});
