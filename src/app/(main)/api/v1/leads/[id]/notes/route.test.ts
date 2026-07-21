import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const createLeadNoteMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/leads/create-lead-note", () => ({ createLeadNote: createLeadNoteMock }));

const FAKE_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

const params = () => Promise.resolve({ id: "lead-1" });

describe("POST /api/v1/leads/[id]/notes — REST parity after createLeadNote extraction", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createLeadNoteMock.mockReset();
    authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
  });

  it("401 when unauthenticated — never calls createLeadNote", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ content: "hi" }), { params: params() });
    expect(res.status).toBe(401);
    expect(createLeadNoteMock).not.toHaveBeenCalled();
  });

  it("not_found outcome -> 404 NOT_FOUND", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "not_found" });
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ content: "hi" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("validation outcome -> 422 VALIDATION_ERROR with field details", async () => {
    createLeadNoteMock.mockResolvedValue({
      kind: "validation",
      errors: { content: ["Note content is required"] },
    });
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ content: "" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.content).toEqual(["Note content is required"]);
  });

  it("db_error outcome -> 503 SERVICE_UNAVAILABLE with the pre-refactor message", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "db_error", error: { message: "boom" } });
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ content: "hi" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.message).toBe("Failed to add note");
  });

  it("ok outcome -> 201 with the created note in the standard envelope", async () => {
    const note = { id: "note-1", content: "hi", created_via: "human" };
    createLeadNoteMock.mockResolvedValue({ kind: "ok", note });
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ content: "hi" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toEqual(note);
  });

  it("parses content/mentioned_user_ids and forces createdVia:'human'/aiToolCallId:null", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "ok", note: { id: "note-1" } });
    const { POST } = await import("./route");
    await POST(fakeReq({ content: "  hi there  ", mentioned_user_ids: ["u1", 42, "u2"] }), { params: params() });

    expect(createLeadNoteMock).toHaveBeenCalledTimes(1);
    const [auth, leadId, input, opts] = createLeadNoteMock.mock.calls[0];
    expect(auth).toBe(FAKE_AUTH);
    expect(leadId).toBe("lead-1");
    expect(input).toEqual({
      content: "hi there",
      mentionedUserIds: ["u1", "u2"],
      createdVia: "human",
      aiToolCallId: null,
    });
    expect(typeof opts.requestId).toBe("string");
  });

  it("invalid JSON body -> content becomes '' -> validation, never throws", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "validation", errors: { content: ["Note content is required"] } });
    const badReq = { json: async () => { throw new Error("bad json"); } } as unknown as NextRequest;
    const { POST } = await import("./route");
    const res = await POST(badReq, { params: params() });
    expect(res.status).toBe(422);
    const [, , input] = createLeadNoteMock.mock.calls[0];
    expect(input.content).toBe("");
  });
});
