import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// F4 (docs/BLAST-F3-F4-FIX-BRIEF.md) — mirrors
// src/app/(main)/api/v1/sms/settings/route.ts's validation shape for the new
// email-side max_recipients_per_blast field.

const requireEmailCampaignsAccessMock = vi.fn();
const requireEmailCampaignsFeatureMock = vi.fn();

vi.mock("@/lib/email/outbound/api-guard", () => ({
  requireEmailCampaignsAccess: requireEmailCampaignsAccessMock,
  requireEmailCampaignsFeature: requireEmailCampaignsFeatureMock,
}));

const OWNER_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(body?: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

function fakeDb(row: { max_recipients_per_blast?: number; daily_send_cap?: number } | null = null) {
  let stored = row;
  const patches: Record<string, unknown>[] = [];
  const db = {
    patches,
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: stored, error: null }) }),
      upsert: (patch: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            patches.push(patch);
            stored = { ...stored, ...patch } as { max_recipients_per_blast?: number; daily_send_cap?: number };
            return Promise.resolve({ data: stored, error: null });
          },
        }),
      }),
    }),
  };
  return db;
}

describe("GET /api/v1/email-blasts/settings", () => {
  beforeEach(() => {
    requireEmailCampaignsFeatureMock.mockReset();
  });

  it("returns the 2,000 default when no settings row exists", async () => {
    requireEmailCampaignsFeatureMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { GET } = await import("./route");
    const res = await GET();
    const json = (await res.json()) as { data: { max_recipients_per_blast: number } };
    expect(json.data.max_recipients_per_blast).toBe(2000);
  });

  it("returns the stored value when a settings row exists", async () => {
    requireEmailCampaignsFeatureMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb({ max_recipients_per_blast: 5000 }) });
    const { GET } = await import("./route");
    const res = await GET();
    const json = (await res.json()) as { data: { max_recipients_per_blast: number } };
    expect(json.data.max_recipients_per_blast).toBe(5000);
  });

  // Finding 2 (PR #514 review): GET must succeed for a tenant whose
  // bulk_email_enabled is false — reading the cap is not a bulk-email action,
  // and every tenant with the Communications panel visible needs this to not
  // 403 before bulk email is ever switched on for them.
  it("returns 200 with the default even when bulk email is not enabled for the tenant", async () => {
    requireEmailCampaignsFeatureMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { GET } = await import("./route");
    const res = await GET();
    const json = (await res.json()) as { data: { max_recipients_per_blast: number } };
    expect(res.status).toBe(200);
    expect(json.data.max_recipients_per_blast).toBe(2000);
  });
});

describe("PATCH /api/v1/email-blasts/settings", () => {
  beforeEach(() => {
    requireEmailCampaignsAccessMock.mockReset();
  });

  it("is admin-only — a viewer is forbidden", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: VIEWER_AUTH, db: fakeDb(null) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ max_recipients_per_blast: 3000 }));
    expect(res.status).toBe(403);
  });

  it("rejects an out-of-bounds value", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ max_recipients_per_blast: 20001 }));
    expect(res.status).toBe(422);
  });

  it("rejects a non-integer value", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ max_recipients_per_blast: 12.5 }));
    expect(res.status).toBe(422);
  });

  it("an admin can raise the cap within bounds", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ max_recipients_per_blast: 8000 }));
    const json = (await res.json()) as { data: { max_recipients_per_blast: number } };
    expect(res.status).toBe(200);
    expect(json.data.max_recipients_per_blast).toBe(8000);
  });

  // Finding 2 (PR #514 review): the full requireEmailCampaignsAccess() guard —
  // including the bulk_email_enabled check — must stay in force on PATCH even
  // though GET no longer requires it. Writing the cap on a tenant that cannot
  // send bulk email at all is meaningless.
  it("stays forbidden for a tenant without bulk email enabled, even as an admin", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { message: "Bulk email is not enabled for this tenant" } }), { status: 403 }),
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ max_recipients_per_blast: 3000 }));
    expect(res.status).toBe(403);
  });
});

describe("daily_send_cap (Outreach bulk enroll, Phase 2c)", () => {
  it("GET returns the 2,000 default and the allowed range when no settings row exists", async () => {
    requireEmailCampaignsFeatureMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { GET } = await import("./route");
    const json = (await (await GET()).json()) as { data: Record<string, number> };
    expect(json.data).toMatchObject({ daily_send_cap: 2000, daily_send_cap_min: 50, daily_send_cap_max: 5000 });
  });

  it("GET returns the stored limit", async () => {
    requireEmailCampaignsFeatureMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb({ daily_send_cap: 3500 }) });
    const { GET } = await import("./route");
    expect(((await (await GET()).json()) as { data: { daily_send_cap: number } }).data.daily_send_cap).toBe(3500);
  });

  it("an admin can set the limit within 50..5000, and only that field is written", async () => {
    const db = fakeDb({ max_recipients_per_blast: 777, daily_send_cap: 2000 });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db });
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ daily_send_cap: 3000 }));
    const json = (await res.json()) as { data: { daily_send_cap: number; max_recipients_per_blast: number } };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ daily_send_cap: 3000, max_recipients_per_blast: 777 }); // the other limit untouched
    expect(db.patches[0]).toEqual({ updated_by: "user-1", daily_send_cap: 3000 });
  });

  it("both limits can be saved together", async () => {
    const db = fakeDb(null);
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ daily_send_cap: 50, max_recipients_per_blast: 100 }));
    expect(res.status).toBe(200);
    expect(db.patches[0]).toEqual({ updated_by: "user-1", daily_send_cap: 50, max_recipients_per_blast: 100 });
  });

  it("rejects below the minimum, above the platform ceiling, non-integers and non-numbers — and writes nothing", async () => {
    const db = fakeDb(null);
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db });
    const { PATCH } = await import("./route");
    for (const bad of [49, 5001, 100000, 2500.5, "lots", null, ""]) {
      expect((await PATCH(fakeReq({ daily_send_cap: bad }))).status).toBe(422);
    }
    expect(db.patches).toHaveLength(0);
  });

  it("a viewer cannot change it", async () => {
    const db = fakeDb(null);
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: VIEWER_AUTH, db });
    const { PATCH } = await import("./route");
    expect((await PATCH(fakeReq({ daily_send_cap: 3000 }))).status).toBe(403);
    expect(db.patches).toHaveLength(0);
  });

  it("an empty body is still rejected", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { PATCH } = await import("./route");
    expect((await PATCH(fakeReq({}))).status).toBe(422);
  });
});
