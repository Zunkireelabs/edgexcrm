import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const scoreRunMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/ai/telemetry", () => ({ scoreRun: scoreRunMock }));

const ADMIN_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "output-1" });

function dbWithExisting(existing: { id: string; kind: string; status: string; run_id?: string } | null, updatedRow?: Record<string, unknown>) {
  const runId = (existing as { run_id?: string } | null)?.run_id ?? "run-1";
  const existingWithRunId = existing ? { ...existing, run_id: runId } : null;
  const updateSpy = vi.fn((row: Record<string, unknown>) => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: { ...updatedRow, ...row }, error: null })),
      })),
    })),
  }));
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: existingWithRunId })) })) })),
      update: updateSpy,
    })),
    __updateSpy: updateSpy,
  };
}

describe("PATCH /api/v1/agent-outputs/[id]", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    scoreRunMock.mockReset();
  });

  it("returns 403 for a non-owner/admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "accept" }), { params });

    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("404s when the output doesn't belong to this tenant", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting(null));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "accept" }), { params });

    expect(res.status).toBe(404);
  });

  it("422s when the row has already been reviewed", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "output-1", kind: "score_suggestion", status: "accepted" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "dismiss" }), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.decision[0]).toMatch(/already been reviewed/i);
  });

  it("422s for an editedPayload that fails the kind's schema", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "output-1", kind: "score_suggestion", status: "proposed" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(
      fakeReq({ decision: "accept", editedPayload: { score: 500, reasoning: "" } }),
      { params },
    );

    expect(res.status).toBe(422);
  });

  it("422s for an editedPayload on a kind with no editor (lead_summary)", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "output-1", kind: "lead_summary", status: "proposed" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(
      fakeReq({ decision: "accept", editedPayload: { summary: "hi" } }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.editedPayload[0]).toMatch(/no editor/i);
  });

  it("accepts a valid edited draft_email payload -> status 'edited_accepted', payload persisted", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "draft_email", status: "proposed" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(
      fakeReq({ decision: "accept", editedPayload: { subject: "Hi there", body: "Following up on your application." } }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const [sawUpdate] = db.__updateSpy.mock.calls[0];
    expect(sawUpdate.status).toBe("edited_accepted");
    expect(sawUpdate.payload).toEqual({ subject: "Hi there", body: "Following up on your application." });
    expect(body.data.status).toBe("edited_accepted");
  });

  it("422s for an edited draft_email payload missing a body", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "output-1", kind: "draft_email", status: "proposed" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(
      fakeReq({ decision: "accept", editedPayload: { subject: "Hi there", body: "" } }),
      { params },
    );

    expect(res.status).toBe(422);
  });

  it("accepts without editedPayload -> status 'accepted'", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "score_suggestion", status: "proposed" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "accept" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    const [sawUpdate] = db.__updateSpy.mock.calls[0];
    expect(sawUpdate.status).toBe("accepted");
    expect(sawUpdate.reviewed_by).toBe("user-1");
    expect(sawUpdate.reviewed_at).toBeTruthy();
    expect(sawUpdate.payload).toBeUndefined();
    expect(body.data.status).toBe("accepted");
  });

  it("accepts with editedPayload -> status 'edited_accepted', payload persisted, reviewed_by/reviewed_at set", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "score_suggestion", status: "proposed" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(
      fakeReq({ decision: "accept", editedPayload: { score: 42, reasoning: "Adjusted after review" } }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const [sawUpdate] = db.__updateSpy.mock.calls[0];
    expect(sawUpdate.status).toBe("edited_accepted");
    expect(sawUpdate.payload).toEqual({ score: 42, reasoning: "Adjusted after review" });
    expect(sawUpdate.reviewed_by).toBe("user-1");
    expect(sawUpdate.reviewed_at).toBeTruthy();
    expect(body.data.status).toBe("edited_accepted");
  });

  it("dismisses -> status 'dismissed'", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "task_suggestion", status: "proposed" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "dismiss" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    const [sawUpdate] = db.__updateSpy.mock.calls[0];
    expect(sawUpdate.status).toBe("dismissed");
    expect(body.data.status).toBe("dismissed");
  });

  it("review_outcome score=1 is emitted for an unedited accept", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "score_suggestion", status: "proposed", run_id: "run-1" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ decision: "accept" }), { params });

    expect(scoreRunMock).toHaveBeenCalledWith("run-1", "review_outcome", 1, expect.stringContaining("accepted"));
  });

  it("review_outcome score=0.5 is emitted for an edited accept", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "score_suggestion", status: "proposed", run_id: "run-1" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ decision: "accept", editedPayload: { score: 42, reasoning: "adjusted" } }), { params });

    expect(scoreRunMock).toHaveBeenCalledWith("run-1", "review_outcome", 0.5, expect.stringContaining("edited_accepted"));
  });

  it("review_outcome score=0 is emitted for a dismiss", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "output-1", kind: "task_suggestion", status: "proposed", run_id: "run-1" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    await PATCH(fakeReq({ decision: "dismiss" }), { params });

    expect(scoreRunMock).toHaveBeenCalledWith("run-1", "review_outcome", 0, expect.stringContaining("dismissed"));
  });
});
