import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { toAiSdkTools, buildToolApproval, buildDeniedWriteActionRows } from "./adapter";
import type { AgentTool, ToolContext } from "./types";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: {} as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

interface StoredRow {
  status: string;
  result: unknown;
}

function fakeWriteDb(opts: {
  existingRow?: StoredRow | null;
  insertError?: { code?: string } | null;
  racedRow?: StoredRow | null;
}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let selectCallCount = 0;

  const db = {
    from: (table: string) => {
      if (table !== "ai_write_actions") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              selectCallCount += 1;
              // 1st select = the up-front idempotency check; a 2nd only happens
              // on the UNIQUE-violation race re-select.
              if (selectCallCount === 1) return { data: opts.existingRow ?? null, error: null };
              return { data: opts.racedRow ?? null, error: null };
            },
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        update: (row: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(row);
            return { error: null };
          },
        }),
      };
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;

  return { db, inserts, updates, getSelectCallCount: () => selectCallCount };
}

function fixtureLogger() {
  const calls: { info: unknown[]; error: unknown[] } = { info: [], error: [] };
  const child = () => ({
    info: (...args: unknown[]) => {
      calls.info.push(args);
    },
    error: (...args: unknown[]) => {
      calls.error.push(args);
    },
  });
  return { logger: { child } as unknown as ToolContext["logger"], calls };
}

function fixtureCtx(db: ScopedClient, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    db,
    auth: fixtureAuth(),
    logger: fixtureLogger().logger,
    runId: "run-1",
    conversationId: "conv-1",
    ...overrides,
  };
}

function fixtureExecOptions(toolCallId: string) {
  return { toolCallId, messages: [] } as never;
}

function writeFixtureTool(execute: AgentTool["execute"]): AgentTool {
  return {
    id: "write_fixture",
    description: "A fixture write tool.",
    inputSchema: z.object({ title: z.string().optional() }),
    scope: "write",
    execute,
  };
}

function readFixtureTool(execute: AgentTool["execute"]): AgentTool {
  return {
    id: "read_fixture",
    description: "A fixture read tool.",
    inputSchema: z.object({}),
    scope: "read",
    execute,
  };
}

describe("toAiSdkTools — write-tool idempotency + audit wrapper", () => {
  it("short-circuits on an existing 'executed' row: execute is never called, stored result is returned", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: { status: "executed", result: { taskId: "t1" } } });
    const executeSpy = vi.fn(async () => ({ taskId: "should-not-run" }));
    const tools = toAiSdkTools([writeFixtureTool(executeSpy)], fixtureCtx(db));

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-1"));

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ taskId: "t1" });
    expect(inserts).toHaveLength(0);
  });

  it("on success, records an 'executed' row with the tool's result and returns it", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: null });
    const tools = toAiSdkTools([writeFixtureTool(async () => ({ taskId: "t9" }))], fixtureCtx(db));

    const result = await tools.write_fixture.execute!({ title: "x" }, fixtureExecOptions("tc-3"));

    expect(result).toEqual({ taskId: "t9" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      status: "executed",
      tool_call_id: "tc-3",
      tool_id: "write_fixture",
      result: { taskId: "t9" },
      user_id: "user-1",
      conversation_id: "conv-1",
    });
  });

  it("on success with no undoOf in the result, records undo_of: null", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: null });
    const tools = toAiSdkTools([writeFixtureTool(async () => ({ taskId: "t9" }))], fixtureCtx(db));

    await tools.write_fixture.execute!({ title: "x" }, fixtureExecOptions("tc-3b"));

    expect(inserts[0]).toMatchObject({ undo_of: null });
  });

  it("copies a result's `undoOf` into the row's `undo_of` column (BRIEF-PHASE-4B undoOf adapter convention)", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: null });
    const tools = toAiSdkTools(
      [writeFixtureTool(async () => ({ leadId: "lead-1", undoOf: "action-123", note: "Action undone." }))],
      fixtureCtx(db),
    );

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-9"));

    expect(result).toEqual({ leadId: "lead-1", undoOf: "action-123", note: "Action undone." });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      status: "executed",
      undo_of: "action-123",
      // result is stored verbatim — undoOf is not stripped out of it.
      result: { leadId: "lead-1", undoOf: "action-123", note: "Action undone." },
    });
  });

  it("copies `undoOf` into the repaired row on a stale-row UNIQUE-violation race", async () => {
    const { db, updates } = fakeWriteDb({
      existingRow: null,
      insertError: { code: "23505" },
      racedRow: { status: "failed", result: { error: "stale" } },
    });
    const tools = toAiSdkTools(
      [writeFixtureTool(async () => ({ leadId: "lead-1", undoOf: "action-456" }))],
      fixtureCtx(db),
    );

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-10"));

    expect(result).toEqual({ leadId: "lead-1", undoOf: "action-456" });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "executed", undo_of: "action-456" });
  });

  it("does not treat a non-string `undoOf` as a link (defensive: ignores malformed tool output)", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: null });
    const tools = toAiSdkTools(
      [writeFixtureTool(async () => ({ undoOf: 12345 }))],
      fixtureCtx(db),
    );

    await tools.write_fixture.execute!({}, fixtureExecOptions("tc-11"));

    expect(inserts[0]).toMatchObject({ undo_of: null });
  });

  it("on a thrown error, records a 'failed' row and still returns the generic model-visible error (never crashes the stream)", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: null });
    const tools = toAiSdkTools(
      [
        writeFixtureTool(async () => {
          throw new Error("boom");
        }),
      ],
      fixtureCtx(db),
    );

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-2"));

    expect(result).toEqual({ error: expect.stringContaining('Something went wrong running "write_fixture"') });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ status: "failed", tool_call_id: "tc-2", error: "boom" });
  });

  it("on a concurrent-duplicate UNIQUE-violation insert failure, returns the winning row's result instead of ours", async () => {
    const { db } = fakeWriteDb({
      existingRow: null,
      insertError: { code: "23505" },
      racedRow: { status: "executed", result: { taskId: "winner" } },
    });
    const tools = toAiSdkTools([writeFixtureTool(async () => ({ taskId: "loser" }))], fixtureCtx(db));

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-4"));

    expect(result).toEqual({ taskId: "winner" });
  });

  it("records a soft-reject { error } result as status:'failed', not 'executed' (result returned to the model unchanged)", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: null });
    const tools = toAiSdkTools(
      [writeFixtureTool(async () => ({ error: "Lead not found in this tenant" }))],
      fixtureCtx(db),
    );

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-6"));

    expect(result).toEqual({ error: "Lead not found in this tenant" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      status: "failed",
      tool_call_id: "tc-6",
      error: "Lead not found in this tenant",
      result: { error: "Lead not found in this tenant" },
    });
  });

  it("blocks execution when the up-front idempotency check finds a 'denied' row — execute is never called", async () => {
    const { db, inserts } = fakeWriteDb({ existingRow: { status: "denied", result: null } });
    const executeSpy = vi.fn(async () => ({ taskId: "should-not-run" }));
    const tools = toAiSdkTools([writeFixtureTool(executeSpy)], fixtureCtx(db));

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-7"));

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: "This action was denied by the user and will not be run. Propose a fresh action if it's still needed.",
    });
    expect(inserts).toHaveLength(0);
  });

  it("on a UNIQUE-violation race where the raced row is NOT 'executed' (e.g. stale 'failed'), repairs it to the fresh outcome and returns our result", async () => {
    const { db, updates } = fakeWriteDb({
      existingRow: null,
      insertError: { code: "23505" },
      racedRow: { status: "failed", result: { error: "stale" } },
    });
    const tools = toAiSdkTools([writeFixtureTool(async () => ({ taskId: "fresh" }))], fixtureCtx(db));

    const result = await tools.write_fixture.execute!({}, fixtureExecOptions("tc-8"));

    expect(result).toEqual({ taskId: "fresh" });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "executed", result: { taskId: "fresh" }, error: null });
  });

  it("threads toolCallId onto ctx for a write-scope tool's execute (Phase 4C)", async () => {
    const { db } = fakeWriteDb({ existingRow: null });
    const captured: ToolContext[] = [];
    const tools = toAiSdkTools(
      [
        writeFixtureTool(async (ctx) => {
          captured.push(ctx);
          return { ok: true };
        }),
      ],
      fixtureCtx(db),
    );

    await tools.write_fixture.execute!({}, fixtureExecOptions("tc-12"));

    expect(captured[0]?.toolCallId).toBe("tc-12");
  });

  it("leaves ctx.toolCallId unset for a read-scope tool", async () => {
    const captured: ToolContext[] = [];
    const tools = toAiSdkTools(
      [
        readFixtureTool(async (ctx) => {
          captured.push(ctx);
          return { ok: true };
        }),
      ],
      fixtureCtx({
        from: () => {
          throw new Error("read tools must not touch the DB via the write-audit path");
        },
        fromGlobal: () => {
          throw new Error("not used");
        },
        raw: () => {
          throw new Error("not used");
        },
      } as unknown as ScopedClient),
    );

    await tools.read_fixture.execute!({}, fixtureExecOptions("tc-13"));

    expect(captured[0]?.toolCallId).toBeUndefined();
  });

  it("never touches ai_write_actions for a read-scope tool", async () => {
    const throwingDb = {
      from: () => {
        throw new Error("read tools must not touch the DB via the write-audit path");
      },
      fromGlobal: () => {
        throw new Error("not used");
      },
      raw: () => {
        throw new Error("not used");
      },
    } as unknown as ScopedClient;
    const tools = toAiSdkTools([readFixtureTool(async () => ({ ok: true }))], fixtureCtx(throwingDb));

    const result = await tools.read_fixture.execute!({}, fixtureExecOptions("tc-5"));

    expect(result).toEqual({ ok: true });
  });
});

describe("buildToolApproval", () => {
  it("requires user-approval for a write-scope tool", () => {
    const approval = buildToolApproval([writeFixtureTool(async () => ({}))]);
    expect(approval.write_fixture).toBe("user-approval");
  });

  it("leaves a read-scope tool unlisted (not-applicable / auto-run, unchanged)", () => {
    const approval = buildToolApproval([readFixtureTool(async () => ({}))]);
    expect(approval.read_fixture).toBeUndefined();
  });
});

describe("buildDeniedWriteActionRows", () => {
  it("builds a 'denied' row for a tool part in approval-responded/approved:false state", () => {
    const messages = [
      { parts: [{ type: "text", text: "hi" }] },
      {
        parts: [
          {
            type: "tool-create_task",
            toolCallId: "tc-1",
            state: "approval-responded",
            input: { title: "Call Aisha" },
            approval: { id: "aitxt-1", approved: false },
          },
        ],
      },
    ];

    const rows = buildDeniedWriteActionRows(messages, "user-1", "conv-1");

    expect(rows).toEqual([
      {
        user_id: "user-1",
        conversation_id: "conv-1",
        tool_call_id: "tc-1",
        tool_id: "create_task",
        input: { title: "Call Aisha" },
        status: "denied",
      },
    ]);
  });

  it("ignores an approved tool part (approval.approved === true)", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool-create_task",
            toolCallId: "tc-2",
            state: "approval-responded",
            input: {},
            approval: { id: "aitxt-2", approved: true },
          },
        ],
      },
    ];
    expect(buildDeniedWriteActionRows(messages, "user-1", null)).toEqual([]);
  });

  it("ignores a pending approval-requested part (no decision yet)", () => {
    const messages = [
      {
        parts: [
          { type: "tool-create_task", toolCallId: "tc-3", state: "approval-requested", input: {}, approval: { id: "aitxt-3" } },
        ],
      },
    ];
    expect(buildDeniedWriteActionRows(messages, "user-1", null)).toEqual([]);
  });

  it("ignores non-tool parts and messages with no parts", () => {
    const messages = [{ parts: [{ type: "text", text: "hi" }] }, {}];
    expect(buildDeniedWriteActionRows(messages, "user-1", null)).toEqual([]);
  });
});
