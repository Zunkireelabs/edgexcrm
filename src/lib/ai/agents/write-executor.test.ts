import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";

// vi.hoisted required: "./write-executor" is imported statically below, and
// static imports execute before any top-level `const`, so a plain
// `const x = vi.fn()` referenced from the vi.mock factory would still be in
// its temporal dead zone when the factory runs.
const { resolveAutomationLevelMock } = vi.hoisted(() => ({ resolveAutomationLevelMock: vi.fn() }));
vi.mock("./policy", () => ({ resolveAutomationLevel: resolveAutomationLevelMock }));
vi.mock("@/lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import {
  deriveWriteIdempotencyKey,
  assertMandatoryRowFilter,
  assertSingleRowEffect,
  isWriteRateCapExceeded,
  MAX_WRITE_ATTEMPTS_PER_RUN,
  buildPolicyEnforcedWriteTools,
} from "./write-executor";

describe("deriveWriteIdempotencyKey", () => {
  it("combines run_id and tool_call_id deterministically", () => {
    expect(deriveWriteIdempotencyKey("run-1", "call-1")).toBe("run-1:call-1");
    expect(deriveWriteIdempotencyKey("run-1", "call-1")).toBe(deriveWriteIdempotencyKey("run-1", "call-1"));
  });

  it("differs when either half differs", () => {
    expect(deriveWriteIdempotencyKey("run-1", "call-1")).not.toBe(deriveWriteIdempotencyKey("run-1", "call-2"));
    expect(deriveWriteIdempotencyKey("run-1", "call-1")).not.toBe(deriveWriteIdempotencyKey("run-2", "call-1"));
  });
});

describe("assertMandatoryRowFilter", () => {
  it("throws when no caller-supplied filter is present (the scopedClient whole-tenant footgun)", () => {
    expect(() => assertMandatoryRowFilter([])).toThrow(/mandatory row-level filter/);
  });

  it("does not throw when at least one filter is present", () => {
    expect(() => assertMandatoryRowFilter([{ column: "id", value: "lead-1" }])).not.toThrow();
  });
});

describe("assertSingleRowEffect", () => {
  it("throws when the match count is not exactly 1", () => {
    expect(() => assertSingleRowEffect(0)).toThrow(/exactly 1 is required/);
    expect(() => assertSingleRowEffect(2)).toThrow(/exactly 1 is required/);
  });

  it("does not throw when exactly 1 row matches", () => {
    expect(() => assertSingleRowEffect(1)).not.toThrow();
  });
});

describe("isWriteRateCapExceeded", () => {
  it("allows attempts up through MAX_WRITE_ATTEMPTS_PER_RUN", () => {
    for (let i = 0; i < MAX_WRITE_ATTEMPTS_PER_RUN; i++) {
      expect(isWriteRateCapExceeded(i)).toBe(false);
    }
  });

  it("trips on the 11th attempt", () => {
    expect(MAX_WRITE_ATTEMPTS_PER_RUN).toBe(10);
    expect(isWriteRateCapExceeded(10)).toBe(true);
  });
});

describe("buildPolicyEnforcedWriteTools", () => {
  const WRITE_TOOL: AgentTool = {
    id: "update_lead_stage",
    description: "test write tool",
    inputSchema: z.object({ leadId: z.string() }),
    scope: "write",
    execute: vi.fn(async () => ({ ok: true })),
  };

  function fakeDb(existingRow: { id: string } | null = null) {
    const inserted: Array<{ table: string; row: unknown }> = [];
    const contains = vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: existingRow }) }));
    const eq = vi.fn(() => ({ contains }));
    const select = vi.fn(() => ({ eq }));
    const insert = vi.fn((row: unknown) => {
      inserted.push({ table: "agent_outputs", row });
      return Promise.resolve({ error: null });
    });
    const db = { from: vi.fn(() => ({ select, insert })) };
    return { db, inserted, select, eq, contains, insert };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAutomationLevelMock.mockResolvedValue("human_led");
  });

  async function callTool(db: unknown, toolCallId = "call-1") {
    const toolset = buildPolicyEnforcedWriteTools([WRITE_TOOL], {
      db: db as never,
      tenantId: "tenant-1",
      agentId: "agent-1",
      runId: "run-1",
      subjectType: "lead",
      subjectId: "lead-1",
    });
    const tool = toolset.update_lead_stage as unknown as { execute: (input: unknown, opts: { toolCallId: string }) => Promise<unknown> };
    return tool.execute({ leadId: "lead-1" }, { toolCallId });
  }

  it("human_led: produces a draft and never calls the underlying tool's execute (zero live writes)", async () => {
    const { db, inserted } = fakeDb(null);

    const result = await callTool(db);

    expect(WRITE_TOOL.execute).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].row).toMatchObject({
      run_id: "run-1",
      agent_id: "agent-1",
      kind: "write_action_proposal",
      status: "proposed",
    });
    expect(result).toMatchObject({ queued: true });
  });

  it.each(["agent_human", "fully_automated"] as const)(
    "%s currently fails closed to a draft too — zero live writes in 5.4a",
    async (level) => {
      resolveAutomationLevelMock.mockResolvedValue(level);
      const { db, inserted } = fakeDb(null);

      const result = await callTool(db);

      expect(WRITE_TOOL.execute).not.toHaveBeenCalled();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].row).toMatchObject({ payload: expect.objectContaining({ automation_level: level }) });
      expect(result).toMatchObject({ queued: true });
    },
  );

  it("is idempotent on (run_id, tool_call_id) — a retry never double-drafts", async () => {
    const { db, inserted } = fakeDb({ id: "existing-draft" });

    const result = await callTool(db, "call-1");

    expect(inserted).toHaveLength(0);
    expect(result).toMatchObject({ queued: true, message: expect.stringMatching(/already queued/i) });
  });

  it("rate-caps at 11 write attempts within a single run", async () => {
    const { db, inserted } = fakeDb(null);
    const toolset = buildPolicyEnforcedWriteTools([WRITE_TOOL], {
      db: db as never,
      tenantId: "tenant-1",
      agentId: "agent-1",
      runId: "run-1",
      subjectType: "lead",
      subjectId: "lead-1",
    });
    const tool = toolset.update_lead_stage as unknown as { execute: (input: unknown, opts: { toolCallId: string }) => Promise<unknown> };

    for (let i = 0; i < MAX_WRITE_ATTEMPTS_PER_RUN; i++) {
      await tool.execute({ leadId: "lead-1" }, { toolCallId: `call-${i}` });
    }
    expect(inserted).toHaveLength(MAX_WRITE_ATTEMPTS_PER_RUN);

    const eleventh = await tool.execute({ leadId: "lead-1" }, { toolCallId: "call-11th" });

    expect(inserted).toHaveLength(MAX_WRITE_ATTEMPTS_PER_RUN);
    expect(eleventh).toMatchObject({ error: expect.stringMatching(/limit/i) });
  });

  it("N parallel execute() calls in one run still respect MAX_WRITE_ATTEMPTS_PER_RUN (5.5 FIXUP Fix B regression guard)", async () => {
    const { db, inserted } = fakeDb(null);
    const toolset = buildPolicyEnforcedWriteTools([WRITE_TOOL], {
      db: db as never,
      tenantId: "tenant-1",
      agentId: "agent-1",
      runId: "run-1",
      subjectType: "lead",
      subjectId: "lead-1",
    });
    const tool = toolset.update_lead_stage as unknown as { execute: (input: unknown, opts: { toolCallId: string }) => Promise<unknown> };

    // Simulates the AI SDK invoking several tool calls concurrently within
    // one step — before Fix B, the attempt slot was reserved after an
    // `await`, so concurrent calls could all read the same stale
    // attemptsThisRun and overshoot the cap.
    const results = await Promise.all(
      Array.from({ length: MAX_WRITE_ATTEMPTS_PER_RUN + 5 }, (_, i) => tool.execute({ leadId: "lead-1" }, { toolCallId: `call-${i}` })),
    );

    expect(inserted).toHaveLength(MAX_WRITE_ATTEMPTS_PER_RUN);
    const capped = results.filter((r) => r && typeof r === "object" && "error" in (r as Record<string, unknown>));
    expect(capped).toHaveLength(5);
  });

  it("strips the internal `proposed` flag from the result returned to the AI SDK (5.5 FIXUP Fix C)", async () => {
    const { db } = fakeDb(null);

    const result = await callTool(db);

    expect(result).toMatchObject({ queued: true });
    expect(result).not.toHaveProperty("proposed");
  });
});
