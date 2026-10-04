import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/v1/outreach/send-window-defaults — the editor's pre-fill: the office timezone and a default window whose
// allowed days are the tenant's WORKING days (every weekday except tenants.weekend_days).

const authMock = vi.fn();
const featureMock = vi.fn();
let tenantRow: Record<string, unknown> | null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    fromGlobal: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenantRow }) }) }) }),
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
  featureMock.mockReset().mockReturnValue(true);
  tenantRow = { timezone: "Asia/Kathmandu", weekend_days: [6] };
});

describe("GET send-window-defaults", () => {
  it("401 signed out, 403 without Outreach", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "x" });
    featureMock.mockReturnValue(false);
    expect((await GET()).status).toBe(403);
  });

  it("Nepal's week (Saturday off): working days are Sun-Fri, 10:00, the lead's zone, a 2 hour spread", async () => {
    const json = (await (await GET()).json()) as { data: { timezone: string; window: Record<string, unknown> } };
    expect(json.data.timezone).toBe("Asia/Kathmandu");
    expect(json.data.window).toEqual({ time: "10:00", days: [0, 1, 2, 3, 4, 5], timezone_mode: "lead", spread_minutes: 120 });
  });

  it("a Sat+Sun weekend gives Mon-Fri", async () => {
    tenantRow = { timezone: "America/New_York", weekend_days: [0, 6] };
    const json = (await (await GET()).json()) as { data: { window: { days: number[] } } };
    expect(json.data.window.days).toEqual([1, 2, 3, 4, 5]);
  });

  it("falls back to UTC and the default weekend when the tenant row is unreadable or has a bad zone", async () => {
    tenantRow = null;
    const a = (await (await GET()).json()) as { data: { timezone: string; window: { days: number[] } } };
    expect(a.data.timezone).toBe("UTC");
    expect(a.data.window.days).toEqual([0, 1, 2, 3, 4, 5]);

    tenantRow = { timezone: "Not/AZone", weekend_days: [6] };
    expect(((await (await GET()).json()) as { data: { timezone: string } }).data.timezone).toBe("UTC");
  });

  it("never offers an empty week (every day marked weekend) — the default days are used instead", async () => {
    tenantRow = { timezone: "UTC", weekend_days: [0, 1, 2, 3, 4, 5, 6] };
    const json = (await (await GET()).json()) as { data: { window: { days: number[] } } };
    expect(json.data.window.days).toEqual([1, 2, 3, 4, 5]);
  });
});
