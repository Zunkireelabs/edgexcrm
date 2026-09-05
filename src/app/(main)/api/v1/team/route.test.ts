import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/v1/team?minimal=1 — the reduced {user_id, name} projection that the
// project board / tasks surfaces lean on to label assignee & owner pickers.
// It must stay reachable by a non-admin whose nav omits /team and who cannot
// assign leads (viewer / counselor), otherwise those pickers render empty and a
// non-admin can't claim work through the UI (regression from PR #500).

const auth = vi.hoisted(() => ({
  current: {
    userId: "u-1",
    email: "viewer@b.c",
    tenantId: "tenant-A",
    role: "viewer",
    industryId: "it_agency",
    permissions: { canAssignLeads: false, nav: [] as string[] },
  } as Record<string, unknown>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

vi.mock("@/lib/api/permissions", () => ({
  // A viewer whose nav does not include /team.
  canSeeNav: () => false,
  resolvePermissions: () => ({ canEditLeads: false }),
  positionPermissionsFromEmbed: () => null,
  deriveRole: () => "viewer",
}));

vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

const members = vi.hoisted(() => ({
  rows: [
    { id: "tu-1", user_id: "user-a", role: "admin", position_id: null, branch_id: null, default_hourly_rate: 120, cost_rate: 80, created_at: "2026-01-01", suspended_at: null, positions: null },
    { id: "tu-2", user_id: "user-b", role: "viewer", position_id: null, branch_id: null, default_hourly_rate: null, cost_rate: null, created_at: "2026-02-01", suspended_at: null, positions: null },
  ],
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({ order: async () => ({ data: members.rows, error: null }) }),
    }),
    raw: () => ({
      auth: {
        admin: {
          listUsers: async () => ({
            data: {
              users: [
                { id: "user-a", email: "ada@agency.com", user_metadata: { name: "Ada Lovelace" } },
                { id: "user-b", email: "bram@agency.com", user_metadata: {} },
              ],
            },
          }),
        },
      },
    }),
  })),
}));

import { GET } from "./route";

function req(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  auth.current = {
    userId: "u-1",
    email: "viewer@b.c",
    tenantId: "tenant-A",
    role: "viewer",
    industryId: "it_agency",
    permissions: { canAssignLeads: false, nav: [] },
  };
});

describe("GET /api/v1/team?minimal=1", () => {
  it("returns {user_id, name} for a non-admin with no /team nav and no lead-assign permission", async () => {
    const res = await GET(req("https://x.test/api/v1/team?minimal=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { user_id: "user-a", name: "Ada Lovelace" },
      { user_id: "user-b", name: "bram@agency.com" }, // falls back to email when no metadata name
    ]);
    // Reduced projection must not leak role / rates.
    expect(body.data[0]).not.toHaveProperty("role");
    expect(body.data[0]).not.toHaveProperty("cost_rate");
    expect(body.data[0]).not.toHaveProperty("default_hourly_rate");
  });

  it("still gates the full roster behind the /team nav / canAssignLeads check", async () => {
    const res = await GET(req("https://x.test/api/v1/team"));
    expect(res.status).toBe(403);
  });
});
