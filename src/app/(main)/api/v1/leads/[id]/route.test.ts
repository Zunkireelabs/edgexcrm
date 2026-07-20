import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const applyLeadPatchMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: applyLeadPatchMock }));

const FAKE_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;

function fakeReq(body: unknown, headers: Record<string, string | null> = {}): NextRequest {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k] ?? null },
  } as unknown as NextRequest;
}

function badJsonReq(): NextRequest {
  return {
    json: async () => {
      throw new Error("bad json");
    },
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const params = () => Promise.resolve({ id: "lead-1" });

describe("PATCH /api/v1/leads/[id] — REST parity after applyLeadPatch extraction", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    applyLeadPatchMock.mockReset();
    authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
  });

  it("401 when unauthenticated — never calls applyLeadPatch", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ status: "qualified" }), { params: params() });
    expect(res.status).toBe(401);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("422 on invalid JSON body — never calls applyLeadPatch", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(badJsonReq(), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.body).toEqual(["Invalid JSON body"]);
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("not_found outcome -> 404 NOT_FOUND", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "not_found" });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ status: "qualified" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Lead not found");
  });

  it("forbidden outcome without a message -> 403 with the generic message", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden" });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "u1" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error.message).toBe("Insufficient permissions");
  });

  it("forbidden outcome with a message -> 403 carrying that exact message", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden", message: "First holder cannot revert this lead" });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ list_id: "l1" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error.message).toBe("First holder cannot revert this lead");
  });

  it("validation outcome -> 422 VALIDATION_ERROR with the field details", async () => {
    applyLeadPatchMock.mockResolvedValue({
      kind: "validation",
      errors: { list_id: ["List not found in this tenant"] },
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ list_id: "bogus" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.list_id).toEqual(["List not found in this tenant"]);
  });

  it("db_error outcome -> 503 SERVICE_UNAVAILABLE with the pre-refactor message", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "db_error", error: { message: "boom" } });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ status: "qualified" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.message).toBe("Failed to update lead");
  });

  it("ok outcome -> 200 with the updated lead in the standard envelope", async () => {
    const lead = { id: "lead-1", first_name: "Aisha", status: "qualified" };
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead, changes: {}, previousValues: {} });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ status: "qualified" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(lead);
  });

  it("passes the lead id, parsed body, and requestId/ip/userAgent through to applyLeadPatch", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: { id: "lead-1" }, changes: {}, previousValues: {} });
    const { PATCH } = await import("./route");
    const req = fakeReq(
      { status: "qualified" },
      { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "vitest-agent" },
    );
    await PATCH(req, { params: params() });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    const [auth, leadId, body, opts] = applyLeadPatchMock.mock.calls[0];
    expect(auth).toBe(FAKE_AUTH);
    expect(leadId).toBe("lead-1");
    expect(body).toEqual({ status: "qualified" });
    expect(opts).toMatchObject({ ip: "1.2.3.4", userAgent: "vitest-agent" });
    expect(typeof opts.requestId).toBe("string");
  });
});
