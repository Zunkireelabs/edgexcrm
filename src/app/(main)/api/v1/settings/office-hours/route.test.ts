import { describe, it, expect, vi, beforeEach } from "vitest";

// PUT/GET /api/v1/settings/office-hours: validation, audit, and what the caller gets back. The permission matrix (401 / other industries /
// counsellor, staff, viewer) lives in api/v1/processes/processes-routes.test.ts alongside every other Processes route.
const auth = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: vi.fn(async () => auth.current) }));
const audit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: audit }));
const scoped = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scoped }));

import { GET, PUT } from "./route";

const upsert = vi.fn();
function db(opts: { saved?: boolean } = {}) {
  const savedJson = { days: [0, 1, 2, 3, 4, 5], start_min: 540, end_min: 1080, source: "saved" };
  const learnedJson = { days: [0, 1, 2, 3, 4, 5, 6], start_min: 540, end_min: 1080, source: "learned", events: 120 };
  let saved = !!opts.saved;
  const rpc = vi.fn(async (name: string) => {
    if (name === "education_office_hours") return { data: saved ? savedJson : learnedJson, error: null };
    if (name === "education_office_hours_evidence") return { data: { by_weekday: [5, 4, 3, 2, 1, 1, 0], by_hour: Array(24).fill(1), total: 16, window_days: 90 }, error: null };
    return { data: null, error: { message: "unknown rpc" } };
  });
  const chain = (r: unknown) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = async () => ({ data: r, error: null });
    c.single = async () => ({ data: r, error: null });
    return c;
  };
  return {
    from: (t: string) => {
      if (t === "tenants") return chain({ name: "Admizz", timezone: "Asia/Kathmandu" });
      return {
        ...chain(saved ? { updated_at: "2026-11-08T06:00:00Z", updated_by: "u-1" } : null),
        upsert: async (row: unknown) => {
          upsert(row);
          saved = true;
          return { error: null };
        },
      };
    },
    raw: () => ({
      rpc,
      from: (t: string) => chain(t === "tenants" ? { name: "Admizz", timezone: "Asia/Kathmandu" } : null),
      auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { name: "Sadin" }, email: "s@x.org" } } }) } },
    }),
  };
}

const put = (body: unknown) => PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as unknown as Parameters<typeof PUT>[0]);

beforeEach(() => {
  upsert.mockReset();
  audit.mockClear();
  scoped.mockReset();
  scoped.mockImplementation(async () => db());
  auth.current = { userId: "u-1", email: "o@x.org", tenantId: "t-1", role: "owner", industryId: "education_consultancy" };
});

describe("GET /settings/office-hours", () => {
  it("returns the learned value with its evidence", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ source: "learned", days: [0, 1, 2, 3, 4, 5, 6], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", events: 120, updatedAt: null });
    expect(data.evidence.byWeekday).toEqual([5, 4, 3, 2, 1, 1, 0]);
    expect(data.evidence.byHour).toHaveLength(24);
  });
  it("returns who saved it and when, once saved", async () => {
    scoped.mockImplementation(async () => db({ saved: true }));
    const { data } = await (await GET()).json();
    expect(data).toMatchObject({ source: "saved", updatedAt: "2026-11-08T06:00:00Z", updatedByName: "Sadin", events: null });
  });
  it("an admin may read it too", async () => {
    auth.current = { ...auth.current, role: "admin" };
    expect((await GET()).status).toBe(200);
  });
});

describe("PUT /settings/office-hours", () => {
  it("saves, audits office_hours.updated with old -> new, and returns the saved value", async () => {
    const res = await put({ days: [5, 0, 1, 2, 3, 4], startMin: 570, endMin: 1050 });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ days: [0, 1, 2, 3, 4, 5], start_min: 570, end_min: 1050, updated_by: "u-1" }));
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t-1",
        userId: "u-1",
        action: "office_hours.updated",
        entityType: "tenant_office_hours",
        entityId: "t-1",
        changes: expect.objectContaining({
          days: { old: [0, 1, 2, 3, 4, 5, 6], new: [0, 1, 2, 3, 4, 5] },
          start_min: { old: 540, new: 570 },
          end_min: { old: 1080, new: 1050 },
          source: { old: "learned", new: "saved" },
        }),
      }),
    );
    const { data } = await res.json();
    expect(data.source).toBe("saved");
  });
  it("an admin may save", async () => {
    auth.current = { ...auth.current, role: "admin" };
    expect((await put({ days: [1], startMin: 540, endMin: 1080 })).status).toBe(200);
  });
  it.each([
    ["no days", { days: [], startMin: 540, endMin: 1080 }],
    ["a day out of range", { days: [7], startMin: 540, endMin: 1080 }],
    ["closing before opening", { days: [1], startMin: 1080, endMin: 540 }],
    ["fractional minutes", { days: [1], startMin: 540.5, endMin: 1080 }],
    ["past midnight", { days: [1], startMin: 540, endMin: 1441 }],
    ["strings", { days: ["1"], startMin: "540", endMin: "1080" }],
    ["nothing", {}],
  ])("422 and no write for %s", async (_n, body) => {
    const res = await put(body);
    expect(res.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it("422 for a body that is not JSON", async () => {
    const res = await PUT(new Request("http://localhost", { method: "PUT", body: "{nope", headers: { "content-type": "application/json" } }) as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(422);
  });
});
