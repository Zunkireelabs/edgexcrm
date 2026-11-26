import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// "Does another lead already have this email?" for the person editing. No database (all mocked).

const state = vi.hoisted(() => ({
  authed: true,
  admin: false,
  canEdit: true,
  lead: { id: "lead-1", email: "old@example.com", assigned_to: "user-1", branch_id: null } as Record<string, unknown> | null,
  ids: [] as string[],
  others: [] as Record<string, unknown>[],
  othersError: null as unknown,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => (state.authed ? { userId: "user-1", tenantId: "tenant-1", role: "staff", industryId: "education_consultancy" } : null)),
  requireAdmin: () => state.admin,
  requireLeadAccess: () => state.canEdit,
}));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: async () => [] }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
const findMock = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock("@/lib/leads/email-duplicate", () => ({ findEmailDuplicateIds: findMock }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => {
      let isDetails = false;
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) b[m] = () => b;
      b.in = () => { isDetails = true; return b; };
      b.maybeSingle = async () => ({ data: state.lead, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(isDetails ? { data: state.others, error: state.othersError } : { data: null, error: null }).then(res);
      return b;
    },
  }),
}));

const get = async (email: string | null) => {
  const { GET } = await import("./route");
  const url = `http://x/api/v1/leads/lead-1/email-check${email === null ? "" : `?email=${encodeURIComponent(email)}`}`;
  return GET({ url } as unknown as NextRequest, { params: Promise.resolve({ id: "lead-1" }) });
};

beforeEach(() => {
  state.authed = true;
  state.admin = false;
  state.canEdit = true;
  state.lead = { id: "lead-1", email: "old@example.com", assigned_to: "user-1", branch_id: null };
  state.ids = [];
  state.others = [];
  state.othersError = null;
  findMock.mockReset().mockImplementation(async () => state.ids);
});

describe("GET /api/v1/leads/:id/email-check", () => {
  it("401 signed out, 404 unknown lead, 403 when you may not edit this lead", async () => {
    state.authed = false;
    expect((await get("a@b.com")).status).toBe(401);
    state.authed = true;
    state.lead = null;
    expect((await get("a@b.com")).status).toBe(404);
    state.lead = { id: "lead-1", email: "old@example.com", assigned_to: "x", branch_id: null };
    state.canEdit = false;
    expect((await get("a@b.com")).status).toBe(403);
    expect(findMock).not.toHaveBeenCalled();
  });

  it("no email, a malformed email, or the lead's own current email: no warning and no search", async () => {
    for (const e of [null, "", "   ", "not-an-email", "OLD@example.com", " old@example.com "]) {
      const body = await (await get(e)).json();
      expect(body.data).toEqual({ duplicate: false, count: 0 });
    }
    expect(findMock).not.toHaveBeenCalled();
  });

  it("another lead has it: a counsellor is told one exists and nothing about it", async () => {
    state.ids = ["other-1"];
    const body = await (await get("Laxmi@Example.com")).json();
    expect(body.data).toEqual({ duplicate: true, count: 1 });
    expect(findMock).toHaveBeenCalledWith(expect.anything(), { tenantId: "tenant-1", leadId: "lead-1", email: "laxmi@example.com" });
  });

  it("an owner or admin also sees which lead (ID and name)", async () => {
    state.admin = true;
    state.ids = ["other-1"];
    state.others = [{ id: "other-1", display_id: "ADM-17703", first_name: "Laxmi", last_name: "Bantha" }];
    const body = await (await get("laxmi@example.com")).json();
    expect(body.data).toEqual({ duplicate: true, count: 1, leads: [{ id: "other-1", display_id: "ADM-17703", name: "Laxmi Bantha" }] });
  });

  it("nobody else has it: no warning", async () => {
    state.admin = true;
    state.ids = [];
    expect((await (await get("free@example.com")).json()).data).toEqual({ duplicate: false, count: 0 });
  });

  it("a failed lookup of the other leads is a 503, not a wrong answer", async () => {
    state.admin = true;
    state.ids = ["other-1"];
    state.othersError = { message: "boom" };
    expect((await get("laxmi@example.com")).status).toBe(503);
  });
});
