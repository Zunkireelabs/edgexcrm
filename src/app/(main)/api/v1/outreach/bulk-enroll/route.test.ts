import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/outreach/bulk-enroll (Start) — the gates that stand between a click and thousands of
// enrollments: auth + feature gate, body validation, an unsupported conflict policy, "nobody to enroll",
// the per-run limit, the typed-confirmation rule from 100 leads, and that a valid start saves the run and
// hands it to the worker.

const authMock = vi.fn();
const featureMock = vi.fn();
const planMock = vi.fn();
const createRunMock = vi.fn();
const processRunMock = vi.fn();
let sequenceRow: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sequenceRow }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}), createServiceClient: async () => ({}) }));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
// run the after() callback straight away so the test can see the worker being kicked
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<void> | void) => void fn() };
});
vi.mock("@/industries/_shared/features/outreach/lib/bulk-enroll-runner", () => ({
  processBulkEnrollRun: (...a: unknown[]) => processRunMock(...a),
}));
vi.mock("@/industries/_shared/features/outreach/lib/bulk-enroll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/industries/_shared/features/outreach/lib/bulk-enroll")>();
  return { ...actual, planBulkEnroll: (...a: unknown[]) => planMock(...a), createBulkEnrollRun: (...a: unknown[]) => createRunMock(...a) };
});

import { POST } from "./route";
import type { NextRequest } from "next/server";

const SEQ = "33333333-3333-4333-8333-333333333333";
const LEAD = "11111111-1111-4111-8111-111111111111";
const auth = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy" };

const post = (body: unknown) =>
  POST({ json: async () => body } as unknown as NextRequest);

const validBody = (extra: Record<string, unknown> = {}) => ({
  sequence_id: SEQ,
  source: { mode: "selected", lead_ids: [LEAD] },
  ...extra,
});

const plan = (willEnroll: number, overLimit = false) => ({
  ok: true,
  plan: { preview: { willEnroll, overLimit, limit: 10000, confirmFrom: 100 }, items: [{ leadId: LEAD, outcome: "pending", reason: null }] },
});

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(auth);
  featureMock.mockReset().mockReturnValue(true);
  planMock.mockReset().mockResolvedValue(plan(5));
  createRunMock.mockReset().mockResolvedValue("run-1");
  processRunMock.mockReset().mockResolvedValue({});
  sequenceRow = { id: SEQ, status: "active" };
});

describe("POST /api/v1/outreach/bulk-enroll", () => {
  it("401 when signed out, 403 when the tenant's industry has no Outreach", async () => {
    authMock.mockResolvedValue(null);
    expect((await post(validBody())).status).toBe(401);

    authMock.mockResolvedValue(auth);
    featureMock.mockReturnValue(false);
    expect((await post(validBody())).status).toBe(403);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("422 for a malformed body and for a conflict policy that is not supported yet", async () => {
    expect((await post({ sequence_id: "nope", source: { mode: "selected", lead_ids: [LEAD] } })).status).toBe(422);
    expect((await post(validBody({ conflict_policy: "switch" }))).status).toBe(422);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("404 when the sequence does not exist or is archived", async () => {
    sequenceRow = null;
    expect((await post(validBody())).status).toBe(404);
    sequenceRow = { id: SEQ, status: "archived" };
    expect((await post(validBody())).status).toBe(404);
  });

  it("422 when nobody can be enrolled, and when the run is over the limit", async () => {
    planMock.mockResolvedValue(plan(0));
    expect((await post(validBody())).status).toBe(422);
    planMock.mockResolvedValue(plan(10_001, true));
    expect((await post(validBody({ confirm: true }))).status).toBe(422);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("from 100 leads up it needs confirm:true — without it nothing is saved", async () => {
    planMock.mockResolvedValue(plan(100));
    expect((await post(validBody())).status).toBe(422);
    expect(createRunMock).not.toHaveBeenCalled();

    expect((await post(validBody({ confirm: true }))).status).toBe(201);
    expect(createRunMock).toHaveBeenCalledTimes(1);
  });

  it("under 100 leads no confirmation is needed; the run is saved and the worker is kicked once", async () => {
    planMock.mockResolvedValue(plan(99));

    const res = await post(validBody());

    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ run_id: "run-1", will_enroll: 99 });
    expect(createRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "u1" }),
      expect.objectContaining({ sequenceId: SEQ, conflictPolicy: "skip" }),
    );
    expect(processRunMock).toHaveBeenCalledWith("t1", "run-1");
  });

  it("a failure saving the run is a 500 and the worker is never kicked", async () => {
    createRunMock.mockRejectedValue(new Error("db down"));
    expect((await post(validBody())).status).toBe(500);
    expect(processRunMock).not.toHaveBeenCalled();
  });
});
