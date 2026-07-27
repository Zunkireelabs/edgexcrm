import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const applyLeadPatchMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: applyLeadPatchMock }));

const ADMIN_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest;
}

const TARGET_ID = "target-1";
const params = Promise.resolve({ id: TARGET_ID });

interface Row extends Record<string, unknown> {
  id: string;
  tool_call_id?: string;
  status: string;
}

/** In-memory ai_write_actions fake — same claim-then-execute shape as approval-gate.test.ts's harness. */
function fakeDb(seed: Row[]) {
  const rows: Row[] = [...seed];
  let seq = rows.length;

  function table() {
    return {
      select: () => ({
        eq: (col1: string, val1: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: rows.find((r) => r[col1] === val1) ?? null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        const dup = rows.find((r) => r.tool_call_id === row.tool_call_id);
        if (dup) return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
        rows.push({ id: `awa-${++seq}`, status: "claimed", ...row } as Row);
        return Promise.resolve({ error: null });
      },
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
            const row = rows.find((r) => filters.every(([c, v]) => r[c] === v));
            if (row) Object.assign(row, values);
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  }

  return {
    from: (t: string) => {
      if (t !== "ai_write_actions") throw new Error(`fakeDb: unexpected table "${t}"`);
      return table();
    },
    rows,
  };
}

function baseTarget(overrides: Partial<Row> = {}): Row {
  return {
    id: TARGET_ID,
    tool_id: "update_lead_stage",
    agent_id: "agent-1",
    run_id: "run-1",
    status: "executed",
    input: { leadId: "lead-1" },
    result: { previous: { list_id: "old-list" } },
    ...overrides,
  };
}

describe("POST /api/v1/agent-writes/[id]/undo", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    applyLeadPatchMock.mockReset();
  });

  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(401);
  });

  it("403s for a non-admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("404s when the target doesn't belong to this tenant (cross-tenant probe) — no mutation", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([]); // scopedClient's tenant filter means a foreign-tenant id resolves to nothing
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(404);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(0);
  });

  it("refuses a non-undoable tool_id", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget({ tool_id: "create_task" })]);
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.toolId[0]).toMatch(/cannot be undone/i);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(1); // no claim row inserted
  });

  it("refuses when the write isn't executed yet", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget({ status: "claimed" })]);
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(422);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("refuses an interactive (agent_id IS NULL) write — this route is for agent writes only", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget({ agent_id: null })]);
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.agentId[0]).toMatch(/agent/i);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("refuses with the specific message when no prior state was recorded", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget({ result: {} })]);
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.result[0]).toMatch(/no prior state was recorded/i);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("refuses with the specific message when the target's input has no leadId", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget({ input: {} })]);
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.leadId[0]).toMatch(/could not determine which lead/i);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("already-undone target: refuses, and does not create a second row", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([
      baseTarget(),
      { id: "awa-undo-1", tool_call_id: `undo:${TARGET_ID}`, status: "executed", undo_of: TARGET_ID },
    ]);
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.id[0]).toMatch(/already been undone|already undone/i);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(2); // no third row created
  });

  it("happy path: undoes the write, restores the patch, finalizes 'executed'", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget()]);
    scopedClientMock.mockResolvedValue(db);
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: { id: "lead-1" }, changes: {}, previousValues: {} });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(200);
    expect(applyLeadPatchMock).toHaveBeenCalledWith(ADMIN_AUTH, "lead-1", { list_id: "old-list" }, expect.any(Object));
    const undoRow = db.rows.find((r) => r.tool_call_id === `undo:${TARGET_ID}`);
    expect(undoRow?.status).toBe("executed");
  });

  it("a governance refusal from applyLeadPatch finalizes the row 'failed', surfaces the message, and returns 4xx", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget()]);
    scopedClientMock.mockResolvedValue(db);
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden", message: "First holder cannot revert this lead" });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.undo[0]).toMatch(/first holder cannot revert this lead/i);
    const undoRow = db.rows.find((r) => r.tool_call_id === `undo:${TARGET_ID}`);
    expect(undoRow?.status).toBe("failed");
    expect(undoRow?.error).toMatch(/first holder cannot revert this lead/i);
  });

  it("double-submit: two concurrent undos of the same target produce exactly one executed undo row", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = fakeDb([baseTarget()]);
    scopedClientMock.mockResolvedValue(db);
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: { id: "lead-1" }, changes: {}, previousValues: {} });
    const { POST } = await import("./route");

    await Promise.all([POST(fakeReq(), { params }), POST(fakeReq(), { params })]);

    const undoRows = db.rows.filter((r) => r.tool_call_id === `undo:${TARGET_ID}`);
    expect(undoRows).toHaveLength(1);
    expect(undoRows[0].status).toBe("executed");
    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1); // the loser never re-executes the patch
  });
});
