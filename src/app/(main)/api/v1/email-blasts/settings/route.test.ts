import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// F4 (docs/BLAST-F3-F4-FIX-BRIEF.md) — mirrors
// src/app/(main)/api/v1/sms/settings/route.ts's validation shape for the new
// email-side max_recipients_per_blast field.

const requireEmailCampaignsAccessMock = vi.fn();

vi.mock("@/lib/email/outbound/api-guard", () => ({ requireEmailCampaignsAccess: requireEmailCampaignsAccessMock }));

const OWNER_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(body?: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

function fakeDb(row: { max_recipients_per_blast?: number } | null = null) {
  let stored = row;
  const db = {
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: stored, error: null }) }),
      upsert: (patch: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            stored = { ...stored, ...patch } as { max_recipients_per_blast?: number };
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
    requireEmailCampaignsAccessMock.mockReset();
  });

  it("returns the 2,000 default when no settings row exists", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb(null) });
    const { GET } = await import("./route");
    const res = await GET();
    const json = (await res.json()) as { data: { max_recipients_per_blast: number } };
    expect(json.data.max_recipients_per_blast).toBe(2000);
  });

  it("returns the stored value when a settings row exists", async () => {
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: OWNER_AUTH, db: fakeDb({ max_recipients_per_blast: 5000 }) });
    const { GET } = await import("./route");
    const res = await GET();
    const json = (await res.json()) as { data: { max_recipients_per_blast: number } };
    expect(json.data.max_recipients_per_blast).toBe(5000);
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
});
