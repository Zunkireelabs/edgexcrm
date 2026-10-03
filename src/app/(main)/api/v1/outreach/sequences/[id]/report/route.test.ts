import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/v1/outreach/sequences/[id]/report — admin only, 404 for an unknown sequence, passes the sequence's own step
// numbers to the report builder, and turns a database failure into a 500 instead of wrong numbers.

const authMock = vi.fn();
const featureMock = vi.fn();
const buildMock = vi.fn();
let sequenceRow: Record<string, unknown> | null;
let stepRows: Array<{ step_order: number }>;

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock("@/industries/_shared/features/outreach/lib/sequence-report", () => ({ buildSequenceReport: (...a: unknown[]) => buildMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: (table: string) => ({
      select: () =>
        table === "email_sequences"
          ? { eq: () => ({ maybeSingle: async () => ({ data: sequenceRow }) }) }
          : { eq: () => ({ order: async () => ({ data: stepRows }) }) },
    }),
  }),
}));

import { GET } from "./route";
import type { NextRequest } from "next/server";

const admin = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy" };
const get = () => GET({} as NextRequest, { params: Promise.resolve({ id: "seq-1" }) });

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(admin);
  featureMock.mockReset().mockReturnValue(true);
  buildMock.mockReset().mockResolvedValue({ enrollments: { total: 3 }, emails: { sent: 1 } });
  sequenceRow = { id: "seq-1", name: "Welcome", auto_send: false, on_reply: "pause" };
  stepRows = [{ step_order: 1 }, { step_order: 2 }, { step_order: 4 }];
});

describe("GET sequence report", () => {
  it("401 signed out, 403 without Outreach and for a non-admin", async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    authMock.mockResolvedValue(admin);
    featureMock.mockReturnValue(false);
    expect((await get()).status).toBe(403);
    featureMock.mockReturnValue(true);
    authMock.mockResolvedValue({ ...admin, role: "viewer" });
    expect((await get()).status).toBe(403);
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("404 for an unknown sequence", async () => {
    sequenceRow = null;
    expect((await get()).status).toBe(404);
  });

  it("builds the report with the sequence's own step numbers and returns it with the sequence", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(buildMock).toHaveBeenCalledWith(expect.anything(), "seq-1", [1, 2, 4]);
    expect(((await res.json()) as { data: { sequence: { name: string }; emails: { sent: number } } }).data).toMatchObject({
      sequence: { name: "Welcome" },
      emails: { sent: 1 },
    });
  });

  it("500 (not wrong numbers) when the report can't be built", async () => {
    buildMock.mockRejectedValue(new Error("db down"));
    expect((await get()).status).toBe(500);
  });
});
