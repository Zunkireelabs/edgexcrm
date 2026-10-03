import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/outreach/sequences/test-send — "Send me a test": gated like Send now (Outreach, education only, bulk-email
// grant) plus admin; sends ONE sample-data email to the caller's OWN address through the normal spine; limited to 10 an
// hour; every outcome of the spine has a plain answer.

const authMock = vi.fn();
const featureMock = vi.fn();
const bulkEnabledMock = vi.fn();
const sendBatchMock = vi.fn();
const inserts: Record<string, unknown>[] = [];
let recentCount: number;
let insertError: { message: string } | null;

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock("@/lib/email/outbound/flag", () => ({
  isBulkEmailEnabledForTenant: (...a: unknown[]) => bulkEnabledMock(...a),
  isEmailOutboundSandbox: () => true,
}));
vi.mock("@/lib/email/outbound/send", () => ({ sendQueuedEmailBatch: (...a: unknown[]) => sendBatchMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    fromGlobal: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Admizz Education" } }) }) }) }),
    from: () => ({
      select: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = { eq: () => b, gte: () => b, then: (r: (v: unknown) => void) => r({ count: recentCount, data: null, error: null }) };
        return b;
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: insertError ? null : { id: "msg-1" }, error: insertError }) }) };
      },
    }),
  }),
}));

import { POST } from "./route";
import type { NextRequest } from "next/server";

const admin = { userId: "u1", tenantId: "t1", role: "admin", email: "Rep@Admizz.org", industryId: "education_consultancy" };
const post = (body: unknown) => POST({ json: async () => body } as unknown as NextRequest);
const valid = { subject_template: "Quick question, {{first_name}}?", body_template: "<p>Hi {{first_name}}</p>", step_label: "Step 1 of Welcome" };

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(admin);
  featureMock.mockReset().mockReturnValue(true);
  bulkEnabledMock.mockReset().mockResolvedValue(true);
  sendBatchMock.mockReset().mockResolvedValue({ sent: 1, failed: 0, suppressed: 0, throttled: 0 });
  inserts.length = 0;
  recentCount = 0;
  insertError = null;
});

describe("POST sequences/test-send", () => {
  it("401 signed out; 403 without Outreach, outside education, and for a non-admin — nothing is queued", async () => {
    authMock.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(401);
    authMock.mockResolvedValue(admin);
    featureMock.mockReturnValue(false);
    expect((await post(valid)).status).toBe(403);
    featureMock.mockReturnValue(true);
    authMock.mockResolvedValue({ ...admin, industryId: "it_agency" });
    expect((await post(valid)).status).toBe(403);
    authMock.mockResolvedValue({ ...admin, role: "viewer" });
    expect((await post(valid)).status).toBe(403);
    expect(inserts).toHaveLength(0);
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("422 for a missing subject / body, 409 when EdgeX sending is off for the tenant", async () => {
    expect((await post({ subject_template: "", body_template: "<p>x</p>" })).status).toBe(422);
    expect((await post({ subject_template: "s", body_template: " " })).status).toBe(422);
    bulkEnabledMock.mockResolvedValue(false);
    expect((await post(valid)).status).toBe(409);
    expect(inserts).toHaveLength(0);
  });

  it("queues ONE manual email to the caller's own (normalized) address with sample data and sends it", async () => {
    const res = await post(valid);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ sent: true, to: "Rep@Admizz.org", sandbox: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ source: "manual", to_email: "rep@admizz.org", to_email_stored: "Rep@Admizz.org", status: "queued", subject: "[Test] Quick question, Jane?" });
    expect(String(inserts[0].body_html)).toContain("<p>Hi Jane</p>");
    expect(String(inserts[0].body_html)).toContain("This is a test of Step 1 of Welcome");
    expect(sendBatchMock).toHaveBeenCalledWith("t1", ["msg-1"]);
  });

  it("429 after 10 tests to the same address within an hour — and nothing more is sent", async () => {
    recentCount = 10;
    const res = await post(valid);
    expect(res.status).toBe(429);
    expect(inserts).toHaveLength(0);
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("answers each spine outcome in plain words: daily cap 429, own address suppressed 422, any other failure 422", async () => {
    sendBatchMock.mockResolvedValue({ sent: 0, failed: 0, suppressed: 0, throttled: 1 });
    let res = await post(valid);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/daily send limit/);

    sendBatchMock.mockResolvedValue({ sent: 0, failed: 0, suppressed: 1, throttled: 0 });
    res = await post(valid);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/do-not-contact/);

    sendBatchMock.mockResolvedValue({ sent: 0, failed: 1, suppressed: 0, throttled: 0 });
    expect((await post(valid)).status).toBe(422);
  });

  it("500 when the test email can't even be queued — and nothing is sent", async () => {
    insertError = { message: "db down" };
    expect((await post(valid)).status).toBe(500);
    expect(sendBatchMock).not.toHaveBeenCalled();
  });
});
