import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/outreach/bulk-enroll/preview — writes nothing; same gates as Start (see ../route.test.ts), and it tells the
// dialog which channel the sequence is on so it can show email limits or SMS credits.

const authMock = vi.fn();
const featureMock = vi.fn();
const planMock = vi.fn();
const smsEnabledMock = vi.fn();
let sequenceRow: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/sms/flag", () => ({ isSmsEnabledForTenant: (...a: unknown[]) => smsEnabledMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sequenceRow }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}), createServiceClient: async () => ({}) }));
vi.mock("@/industries/_shared/features/outreach/lib/bulk-enroll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/industries/_shared/features/outreach/lib/bulk-enroll")>();
  return { ...actual, planBulkEnroll: (...a: unknown[]) => planMock(...a) };
});

import { POST } from "./route";
import type { NextRequest } from "next/server";

const SEQ = "33333333-3333-4333-8333-333333333333";
const LEAD = "11111111-1111-4111-8111-111111111111";
const auth = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy", permissions: { canSendSms: true } };
const post = (body: unknown = { sequence_id: SEQ, source: { mode: "selected", lead_ids: [LEAD] } }) => POST({ json: async () => body } as unknown as NextRequest);

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(auth);
  featureMock.mockReset().mockReturnValue(true);
  smsEnabledMock.mockReset().mockResolvedValue(true);
  planMock.mockReset().mockResolvedValue({ ok: true, plan: { preview: { willEnroll: 3, channel: "email" }, items: [] } });
  sequenceRow = { id: SEQ, name: "Welcome", status: "active", auto_send: false, send_window: null, channel: "email" };
});

describe("POST /api/v1/outreach/bulk-enroll/preview", () => {
  it("401 / 403 / 404 gates", async () => {
    authMock.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    authMock.mockResolvedValue(auth);
    featureMock.mockReturnValue(false);
    expect((await post()).status).toBe(403);
    featureMock.mockReturnValue(true);
    sequenceRow = null;
    expect((await post()).status).toBe(404);
    expect(planMock).not.toHaveBeenCalled();
  });

  it("an email sequence is planned for the email channel and reports it", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(planMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { sequenceId: SEQ, conflictPolicy: "skip", channel: "email" });
    expect((await res.json()).data.sequence).toMatchObject({ id: SEQ, channel: "email" });
  });

  it("an SMS sequence is planned for the SMS channel", async () => {
    sequenceRow = { ...sequenceRow, channel: "sms" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(planMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { sequenceId: SEQ, conflictPolicy: "skip", channel: "sms" });
    expect((await res.json()).data.sequence.channel).toBe("sms");
  });

  it("an SMS sequence needs SMS turned on and SMS permission, like Start (nothing is planned otherwise)", async () => {
    sequenceRow = { ...sequenceRow, channel: "sms" };
    smsEnabledMock.mockResolvedValue(false);
    expect((await post()).status).toBe(403);
    smsEnabledMock.mockResolvedValue(true);
    authMock.mockResolvedValue({ ...auth, permissions: { canSendSms: false } });
    expect((await post()).status).toBe(403);
    expect(planMock).not.toHaveBeenCalled();
  });

  it("422 for a bad conflict policy", async () => {
    expect((await post({ sequence_id: SEQ, source: { mode: "selected", lead_ids: [LEAD] }, conflict_policy: "replace" })).status).toBe(422);
  });
});
