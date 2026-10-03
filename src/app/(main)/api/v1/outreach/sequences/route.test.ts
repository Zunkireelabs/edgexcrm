import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/outreach/sequences — the send window (migration 260): validated, stored as given, null/omitted = no
// window. (The rest of create — name, steps — is covered by the existing flows.)

const authMock = vi.fn();
let inserted: Record<string, unknown>[];

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === "email_sequences") inserted.push(payload as Record<string, unknown>);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          select: () => b,
          single: async () => ({ data: { id: "seq-1", ...(payload as Record<string, unknown>) }, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        };
        return b;
      },
    }),
  }),
}));

import { POST } from "./route";
import type { NextRequest } from "next/server";

const admin = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy" };
const steps = [{ step_order: 1, delay_days: 0, subject_template: "Hi", body_template: "<p>Hi</p>" }];
const post = (extra: Record<string, unknown>) =>
  POST({ json: async () => ({ name: "Welcome", steps, ...extra }) } as unknown as NextRequest);

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(admin);
  inserted = [];
});

describe("POST sequences — send_window", () => {
  it("stores a valid window (days sorted / de-duplicated)", async () => {
    const res = await post({ send_window: { time: "09:30", days: [5, 1, 1], timezone_mode: "lead", spread_minutes: 60 } });
    expect(res.status).toBe(201);
    expect(inserted[0].send_window).toEqual({ time: "09:30", days: [1, 5], timezone_mode: "lead", spread_minutes: 60 });
  });

  it("no window / null stores null — the old send-as-soon-as-due behaviour", async () => {
    expect((await post({})).status).toBe(201);
    expect((await post({ send_window: null })).status).toBe(201);
    expect(inserted.map((i) => i.send_window)).toEqual([null, null]);
  });

  it("422 for a bad window, and nothing is created", async () => {
    for (const bad of [{ time: "9am", days: [1], timezone_mode: "lead", spread_minutes: 0 }, { time: "10:00", days: [], timezone_mode: "lead", spread_minutes: 0 }, "weekdays"]) {
      expect((await post({ send_window: bad })).status).toBe(422);
    }
    expect(inserted).toHaveLength(0);
  });
});
