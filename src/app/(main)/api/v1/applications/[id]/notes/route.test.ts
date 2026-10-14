// Application notes now carry the files attached to them (migration 273).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const accessMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/api/applications", () => ({ getApplicationWithAccess: accessMock }));

const AUTH = { userId: "u1", tenantId: "t1", industryId: "education_consultancy" } as unknown as AuthContext;
const req = () => ({}) as unknown as NextRequest;
const params = () => ({ params: Promise.resolve({ id: "app-1" }) });

function fakeDb(notes: Record<string, unknown>[], docs: Record<string, unknown>[] | "fail") {
  const noteQuery = { eq: vi.fn(() => noteQuery), order: vi.fn(async () => ({ data: notes, error: null })) };
  const docQuery = {
    in: vi.fn(() => docQuery),
    is: vi.fn(() => docQuery),
    order: vi.fn(async () => (docs === "fail" ? { data: null, error: { message: "x" } } : { data: docs, error: null })),
  };
  const from = vi.fn((t: string) => ({ select: vi.fn(() => (t === "application_notes" ? noteQuery : docQuery)) }));
  return { db: { from }, docQuery };
}

beforeEach(() => {
  for (const m of [authenticateRequestMock, getFeatureAccessMock, scopedClientMock, accessMock]) m.mockReset();
  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  accessMock.mockResolvedValue({ allowed: true, viaCollaborator: false });
});

describe("GET /api/v1/applications/[id]/notes", () => {
  it("returns each note with ITS OWN attached files", async () => {
    const f = fakeDb(
      [{ id: "n1", content: "Offer received" }, { id: "n2", content: "Chasing visa" }],
      [
        { id: "d1", name: "Conditional offer", document_type: "conditional_offer", application_note_id: "n1" },
        { id: "d2", name: "Unconditional offer", document_type: "unconditional_offer", application_note_id: "n1" },
      ],
    );
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    const json = await (await GET(req(), params())).json();
    expect(json.data.map((n: { id: string; documents: unknown[] }) => [n.id, n.documents.length])).toEqual([["n1", 2], ["n2", 0]]);
    expect(f.docQuery.in).toHaveBeenCalledWith("application_note_id", ["n1", "n2"]);
    expect(f.docQuery.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("does not look up files when there are no notes", async () => {
    const f = fakeDb([], []);
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    expect((await (await GET(req(), params())).json()).data).toEqual([]);
    expect(f.docQuery.in).not.toHaveBeenCalled();
  });

  it("still returns every note when the file lookup fails", async () => {
    const f = fakeDb([{ id: "n1", content: "hello" }], "fail");
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: "n1", content: "hello", documents: [] }]);
  });

  it("404s for an application the caller cannot access", async () => {
    accessMock.mockResolvedValue({ allowed: false });
    const { GET } = await import("./route");
    expect((await GET(req(), params())).status).toBe(404);
  });
});
