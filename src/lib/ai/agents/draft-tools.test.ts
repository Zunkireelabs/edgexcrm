import { describe, it, expect, vi } from "vitest";
import { buildDraftTools } from "./draft-tools";
import type { ScopedClient } from "@/lib/supabase/scoped";

function fakeDb(insertSpy: (table: string, row: unknown) => void, error: unknown = null): ScopedClient {
  return {
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertSpy(table, row);
        return Promise.resolve({ error });
      },
    }),
    fromGlobal: () => {
      throw new Error("not used in this suite");
    },
    raw: () => {
      throw new Error("not used in this suite");
    },
  } as unknown as ScopedClient;
}

describe("buildDraftTools", () => {
  it("propose_score inserts exactly one agent_outputs row — never touches any live table", async () => {
    const calls: Array<{ table: string; row: unknown }> = [];
    const db = fakeDb((table, row) => calls.push({ table, row }));
    const tools = buildDraftTools({ agentId: "agent-1", runId: "run-1", db, subjectType: "lead", subjectId: "lead-1" });

    // AI SDK `tool()` wraps execute; call it the same way generateText would.
    const result = await tools.propose_score.execute!({ score: 82, reasoning: "Strong fit, matches ICP." }, {
      toolCallId: "tc-1",
      messages: [],
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("agent_outputs");
    expect(calls[0].row).toMatchObject({
      run_id: "run-1",
      agent_id: "agent-1",
      kind: "score_suggestion",
      subject_type: "lead",
      subject_id: "lead-1",
      status: "proposed",
      payload: { score: 82, reasoning: "Strong fit, matches ICP." },
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("propose_task inserts exactly one agent_outputs row with kind:'task_suggestion'", async () => {
    const calls: Array<{ table: string; row: unknown }> = [];
    const db = fakeDb((table, row) => calls.push({ table, row }));
    const tools = buildDraftTools({ agentId: "agent-1", runId: "run-1", db, subjectType: "lead", subjectId: "lead-1" });

    await tools.propose_task.execute!({ title: "Call within 24h" }, { toolCallId: "tc-2", messages: [] } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("agent_outputs");
    expect(calls[0].row).toMatchObject({
      kind: "task_suggestion",
      subject_type: "lead",
      subject_id: "lead-1",
      status: "proposed",
      payload: { title: "Call within 24h", description: null, dueDate: null },
    });
  });

  it("subject_id/subject_type come from the run's closure context, never from model input", async () => {
    const calls: Array<{ table: string; row: unknown }> = [];
    const db = fakeDb((table, row) => calls.push({ table, row }));
    const tools = buildDraftTools({ agentId: "agent-1", runId: "run-1", db, subjectType: "lead", subjectId: "lead-real" });

    // propose_score's input schema has no leadId/subjectId field at all — a
    // model cannot even attempt to name a different subject.
    expect(tools.propose_score.inputSchema).toBeDefined();

    await tools.propose_score.execute!({ score: 10, reasoning: "x" }, { toolCallId: "tc-3", messages: [] } as never);
    expect((calls[0].row as { subject_id: string }).subject_id).toBe("lead-real");
  });

  it("throws (surfaced by the adapter as a model-visible error) when the insert fails", async () => {
    const db = fakeDb(vi.fn(), { message: "insert failed" });
    const tools = buildDraftTools({ agentId: "agent-1", runId: "run-1", db, subjectType: "lead", subjectId: "lead-1" });

    await expect(
      tools.propose_score.execute!({ score: 1, reasoning: "x" }, { toolCallId: "tc-4", messages: [] } as never),
    ).rejects.toThrow(/insert failed/);
  });
});
