import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/v1/inbox/channels — not admin-gated, so it must never leak the
// shared META_WEBHOOK_VERIFY_TOKEN to any authenticated user.

const auth = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

const channelRows = vi.hoisted(() => ({
  current: [
    {
      id: "chan-1",
      provider: "whatsapp",
      external_account_id: "123",
      display_name: "Main",
      status: "active",
      access_token: "encrypted-blob",
      webhook_verify_token_hash: "hash",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-02T00:00:00Z",
    },
  ] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        order: async () => ({ data: channelRows.current, error: null }),
      }),
    }),
  })),
}));

import { GET } from "./route";

beforeEach(() => {
  auth.current = {
    userId: "u-1",
    email: "viewer@tenant.com",
    tenantId: "tenant-A",
    role: "viewer",
    industryId: "it_agency",
  };
  process.env.META_WEBHOOK_VERIFY_TOKEN = "super-secret-verify-token";
});

describe("GET /api/v1/inbox/channels", () => {
  it("never includes verify_token — this route authenticates but does not admin-gate", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const json = JSON.stringify(body);
    expect(json).not.toContain("verify_token");
    expect(json).not.toContain("super-secret-verify-token");
  });

  it("reports whether the token is set without exposing it", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ id: "chan-1", access_token_set: true });
    expect(body.data[0].access_token).toBeUndefined();
  });
});
