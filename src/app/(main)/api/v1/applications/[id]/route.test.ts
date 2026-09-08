import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Regression coverage for a real PR-review finding: moving an application's
// stage used to write TWO audit_logs rows for one action — the pre-existing
// generic "application.updated" (rendered "Updated 3 fields") plus the
// dedicated "application.stage_changed" (rendered "Stage changed to X") —
// because nothing deduped the fields the stage move itself derives
// (stage_id, status, stage_changed_at) out of the generic write. A pure
// stage move must now write exactly ONE audit_logs row (stage_changed); a
// request that also changes an unrelated field alongside the stage still
// gets both rows, but the generic one must only describe the genuinely
// separate field(s), not the stage bookkeeping.

const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "user-1",
    tenantId: "tenant-1",
    role: "admin",
    industryId: "education_consultancy",
    permissions: { baseTier: "admin" },
  })),
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

const existingRow = {
  id: "app-1",
  lead_id: "lead-1",
  stage_id: "stage-new",
  status: "new",
  notes: "old notes",
  assigned_to: null,
};

vi.mock("@/lib/api/applications", () => ({
  getApplicationWithAccess: vi.fn(async () => ({
    allowed: true,
    application: { ...existingRow },
    parentLead: { id: "lead-1", branch_id: null, assigned_to: null },
    membership: [],
    viaCollaborator: false,
  })),
  canManageApplicationForLead: () => true,
}));

function fakeScopedClient(opts: { updatedRow: Record<string, unknown> }) {
  return {
    from(table: string) {
      if (table === "application_stages") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: "stage-qualified", slug: "qualified", terminal_type: null } }) }),
          }),
        };
      }
      if (table === "applications") {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({ single: async () => ({ data: opts.updatedRow, error: null }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn() }));

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "app-1" });

describe("PATCH /api/v1/applications/[id] — audit-log dedup on stage move", () => {
  beforeEach(async () => {
    createAuditLogMock.mockReset();
    emitEventMock.mockReset();
    const { scopedClient } = await import("@/lib/supabase/scoped");
    vi.mocked(scopedClient).mockResolvedValue(
      fakeScopedClient({
        updatedRow: { ...existingRow, stage_id: "stage-qualified", status: "qualified", stage_changed_at: "2026-09-08T00:00:00Z" },
      }) as never
    );
  });

  it("a PURE stage move writes exactly ONE audit_logs row (stage_changed), not two", async () => {
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ stage_id: "stage-qualified" }), { params });

    const auditActions = createAuditLogMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(auditActions).toEqual(["application.stage_changed"]);
    // emitEvent (webhooks) is a separate concern from the Activity-tab audit
    // log — both application.updated and application.stage_changed events
    // still fire, unaffected by this dedup.
    const emitActions = emitEventMock.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(emitActions).toEqual(["application.updated", "application.stage_changed"]);
  });

  it("a stage move COMBINED with an unrelated field change still writes both rows, and the generic one excludes the stage bookkeeping fields", async () => {
    const { scopedClient } = await import("@/lib/supabase/scoped");
    vi.mocked(scopedClient).mockResolvedValue(
      fakeScopedClient({
        updatedRow: {
          ...existingRow,
          stage_id: "stage-qualified",
          status: "qualified",
          stage_changed_at: "2026-09-08T00:00:00Z",
          notes: "updated notes",
        },
      }) as never
    );
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ stage_id: "stage-qualified", notes: "updated notes" }), { params });

    const auditCalls = createAuditLogMock.mock.calls as unknown as [{ action: string; changes: { patch: { new: Record<string, unknown> } } }][];
    const actions = auditCalls.map(([c]) => c.action);
    expect(actions.sort()).toEqual(["application.stage_changed", "application.updated"]);

    const genericCall = auditCalls.find(([c]) => c.action === "application.updated")![0];
    // The generic row must describe ONLY the genuinely separate field(s) —
    // stage_id/status/stage_changed_at belong to the stage_changed row, not
    // this one, or "Updated N fields" double-counts the stage bookkeeping.
    // notes_updated_by/notes_updated_at are the route's own bookkeeping for
    // the notes field itself (unrelated to the stage-move dedup), so they're
    // expected here too.
    expect(Object.keys(genericCall.changes.patch.new).sort()).toEqual(["notes", "notes_updated_at", "notes_updated_by"]);

    const stageCall = auditCalls.find(([c]) => c.action === "application.stage_changed")![0];
    expect(stageCall.changes.patch.new).toMatchObject({ stage_id: "stage-qualified" });
  });

  it("a non-stage field edit is unaffected — still writes a single application.updated row, no stage_changed", async () => {
    const { scopedClient } = await import("@/lib/supabase/scoped");
    vi.mocked(scopedClient).mockResolvedValue(fakeScopedClient({ updatedRow: { ...existingRow, notes: "new notes" } }) as never);
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ notes: "new notes" }), { params });

    const auditActions = createAuditLogMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(auditActions).toEqual(["application.updated"]);
  });
});
