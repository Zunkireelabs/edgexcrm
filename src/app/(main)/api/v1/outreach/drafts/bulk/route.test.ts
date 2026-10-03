import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/outreach/drafts/bulk — Send now / Schedule / Skip for many drafts. Pins the gates (send / schedule are
// education-only and need the bulk-email grant; skip needs neither), the confirmation from 50 drafts, the 5,000 cap, that
// send = "scheduled for now" (the timer sends, the request doesn't), and that skip works in short batches with `remaining`.

const authMock = vi.fn();
const featureMock = vi.fn();
const bulkEnabledMock = vi.fn();
const skipMock = vi.fn();
const resolveMock = vi.fn();
const scheduleMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock("@/lib/email/outbound/flag", () => ({
  isBulkEmailEnabledForTenant: (...a: unknown[]) => bulkEnabledMock(...a),
  isEmailOutboundSandbox: () => true,
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => ({ marker: "db" }) }));
vi.mock("@/industries/_shared/features/outreach/lib/engine", () => ({ skipDraft: (...a: unknown[]) => skipMock(...a) }));
vi.mock("@/industries/_shared/features/outreach/lib/bulk-drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/industries/_shared/features/outreach/lib/bulk-drafts")>();
  return { ...actual, resolveEligibleDrafts: (...a: unknown[]) => resolveMock(...a), scheduleDrafts: (...a: unknown[]) => scheduleMock(...a) };
});

import { POST } from "./route";
import type { NextRequest } from "next/server";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const edu = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy" };
const post = (body: unknown) => POST({ json: async () => body } as unknown as NextRequest);
const ids = (n: number) => ({ mode: "ids", ids: Array.from({ length: n }, (_, i) => U(i + 1)) });
const eligible = (n: number, extra: Record<string, unknown> = {}) => ({
  eligible: Array.from({ length: n }, (_, i) => ({ id: U(i + 1), subject: "s", leads: { email: "a@b.com" } })),
  matched: n, skipped: { noSubject: 0, noEmail: 0 }, notAvailable: 0, truncated: false, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T04:00:00Z"));
  authMock.mockReset().mockResolvedValue(edu);
  featureMock.mockReset().mockReturnValue(true);
  bulkEnabledMock.mockReset().mockResolvedValue(true);
  skipMock.mockReset().mockResolvedValue(true);
  resolveMock.mockReset().mockResolvedValue(eligible(3));
  scheduleMock.mockReset().mockImplementation(async (_db: unknown, _a: unknown, idList: string[]) => idList.length);
});
afterEach(() => vi.useRealTimers());

describe("gates", () => {
  it("401 signed out, 403 without Outreach, 422 for a malformed body", async () => {
    authMock.mockResolvedValue(null);
    expect((await post({ action: "send", selection: ids(1) })).status).toBe(401);
    authMock.mockResolvedValue(edu);
    featureMock.mockReturnValue(false);
    expect((await post({ action: "send", selection: ids(1) })).status).toBe(403);
    featureMock.mockReturnValue(true);
    expect((await post({ action: "explode", selection: ids(1) })).status).toBe(422);
    expect((await post({ action: "send", selection: { mode: "ids", ids: [] } })).status).toBe(422);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("send and schedule: 403 outside education and 409 when EdgeX sending is off — nothing is resolved or written", async () => {
    authMock.mockResolvedValue({ ...edu, industryId: "it_agency" });
    expect((await post({ action: "send", selection: ids(1) })).status).toBe(403);
    authMock.mockResolvedValue(edu);
    bulkEnabledMock.mockResolvedValue(false);
    expect((await post({ action: "send", selection: ids(1) })).status).toBe(409);
    expect((await post({ action: "schedule", selection: ids(1), send_at: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(409);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("skip needs neither education nor the sending grant", async () => {
    authMock.mockResolvedValue({ ...edu, industryId: "it_agency" });
    bulkEnabledMock.mockResolvedValue(false);
    expect((await post({ action: "skip", selection: ids(3) })).status).toBe(200);
    expect(bulkEnabledMock).not.toHaveBeenCalled();
  });

  it("422 NOTHING_TO_DO when no draft is usable", async () => {
    resolveMock.mockResolvedValue(eligible(0));
    const res = await post({ action: "send", selection: ids(2) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOTHING_TO_DO");
  });
});

describe("send / schedule", () => {
  it("send = scheduled for NOW (the timer sends them): sets the time, the request sends nothing itself", async () => {
    resolveMock.mockResolvedValue(eligible(3, { skipped: { noSubject: 1, noEmail: 2 }, notAvailable: 4, matched: 10 }));

    const res = await post({ action: "send", selection: ids(10) });
    const json = (await res.json()) as { data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][2]).toEqual([U(1), U(2), U(3)]);
    expect((scheduleMock.mock.calls[0][3] as Date).toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(json.data).toMatchObject({
      action: "send", matched: 10, applied: 3, remaining: 0, sandbox: true, send_at: "2026-10-05T04:00:00.000Z",
      skipped: { no_subject: 1, no_email: 2, not_available: 4 },
    });
    expect(resolveMock.mock.calls[0][3]).toEqual({ forSending: true, limit: 5000 });
  });

  it("schedule uses the chosen time", async () => {
    const sendAt = new Date(Date.now() + 3 * 3600_000).toISOString();
    const res = await post({ action: "schedule", selection: ids(3), send_at: sendAt });
    expect(res.status).toBe(200);
    expect((scheduleMock.mock.calls[0][3] as Date).toISOString()).toBe(sendAt);
  });

  it("from 50 drafts up it needs confirm:true — without it nothing is scheduled", async () => {
    resolveMock.mockResolvedValue(eligible(50));
    expect((await post({ action: "send", selection: ids(50) })).status).toBe(422);
    expect(scheduleMock).not.toHaveBeenCalled();
    expect((await post({ action: "send", selection: ids(50), confirm: true })).status).toBe(200);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it("more than 5,000 matches is refused with a plain 'narrow it' message", async () => {
    resolveMock.mockResolvedValue(eligible(10, { truncated: true, matched: 7000 }));
    const res = await post({ action: "send", selection: { mode: "all", due: "all" }, confirm: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY");
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});

describe("skip", () => {
  it("skips each draft one at a time and reports applied / failed", async () => {
    resolveMock.mockResolvedValue(eligible(3));
    skipMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("boom"));

    const res = await post({ action: "skip", selection: ids(3) });
    const json = (await res.json()) as { data: Record<string, unknown> };

    expect(skipMock).toHaveBeenCalledTimes(3);
    expect(json.data).toMatchObject({ action: "skip", applied: 1, failed: 2, remaining: 0 });
    expect(resolveMock.mock.calls[0][3]).toEqual({ forSending: false, limit: 50 });
  });

  it("works in batches of 50 and says how many are left, so the screen can repeat it", async () => {
    resolveMock.mockResolvedValue(eligible(50, { matched: 130 }));
    const res = await post({ action: "skip", selection: { mode: "all", due: "all" }, confirm: true });
    expect(((await res.json()) as { data: { applied: number; remaining: number } }).data).toMatchObject({ applied: 50, remaining: 80 });
  });

  it("confirmation is judged on the WHOLE job, not the batch: 130 matches need confirm even though a batch is 50", async () => {
    resolveMock.mockResolvedValue(eligible(50, { matched: 130 }));
    expect((await post({ action: "skip", selection: { mode: "all", due: "all" } })).status).toBe(422);
    expect(skipMock).not.toHaveBeenCalled();
  });

  it("under 50 drafts no confirmation is needed", async () => {
    resolveMock.mockResolvedValue(eligible(49));
    expect((await post({ action: "skip", selection: ids(49) })).status).toBe(200);
  });
});
