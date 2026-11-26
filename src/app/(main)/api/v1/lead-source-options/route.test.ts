import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Lead Source dropdown options: the starting lists + what an admin adds. No database (everything mocked).

const state = vi.hoisted(() => ({
  role: "admin" as string | null, // null = signed out
  rows: [] as { kind: string; value: string; label: string }[],
  readError: false,
  insertError: null as null | { code: string },
  inserted: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () =>
    state.role ? { userId: "user-1", tenantId: "tenant-1", role: state.role, industryId: "education_consultancy", branchId: null, permissions: {} } : null),
}));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({
      select: () => ({
        order: async () => (state.readError ? { data: null, error: { message: "boom" } } : { data: state.rows, error: null }),
      }),
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { error: state.insertError };
      },
    }),
  }),
}));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST({ json: async () => body } as unknown as NextRequest);
};
const get = async () => (await import("./route")).GET();

beforeEach(() => {
  state.role = "admin";
  state.rows = [];
  state.readError = false;
  state.insertError = null;
  state.inserted = [];
});

describe("GET /api/v1/lead-source-options", () => {
  it("401 when signed out", async () => {
    state.role = null;
    expect((await get()).status).toBe(401);
  });

  it("returns the starting lists plus the tenant's additions", async () => {
    state.rows = [{ kind: "account", value: "admizz_facebook", label: "Admizz Facebook" }];
    const body = await (await get()).json();
    expect(body.data.category.map((o: { value: string }) => o.value)).toContain("google");
    expect(body.data.channel.map((o: { value: string }) => o.value)).toContain("check_in");
    expect(body.data.account).toEqual([{ value: "admizz_facebook", label: "Admizz Facebook" }]);
  });

  it("still returns the starting lists when the additions cannot be read", async () => {
    state.readError = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).data.account).toEqual([]);
  });
});

describe("POST /api/v1/lead-source-options", () => {
  it("401 when signed out, 403 for anyone but owner/admin", async () => {
    state.role = null;
    expect((await post({ kind: "account", label: "X" })).status).toBe(401);
    state.role = "counselor";
    expect((await post({ kind: "account", label: "X" })).status).toBe(403);
    state.role = "viewer";
    expect((await post({ kind: "account", label: "X" })).status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it("rejects an unknown list, an empty name and an over-long name", async () => {
    expect((await post({ kind: "campaign", label: "X" })).status).toBe(422);
    expect((await post({ kind: "account", label: "   " })).status).toBe(422);
    expect((await post({ kind: "account", label: "x".repeat(61) })).status).toBe(422);
    expect((await post({ kind: "account", label: "***" })).status).toBe(422);
    expect(state.inserted).toEqual([]);
  });

  it("an admin adds a new option: slug value, readable label, who added it", async () => {
    const res = await post({ kind: "account", label: "  Admizz  Instagram " });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ kind: "account", value: "admizz_instagram", label: "Admizz Instagram", created: true });
    expect(state.inserted).toEqual([{ kind: "account", value: "admizz_instagram", label: "Admizz Instagram", created_by: "user-1" }]);
  });

  it("owner can add too", async () => {
    state.role = "owner";
    expect((await post({ kind: "category", label: "Radio" })).status).toBe(201);
  });

  it("adding something already in the starting list returns it, and writes nothing", async () => {
    const res = await post({ kind: "category", label: "google" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ value: "google", created: false });
    expect(state.inserted).toEqual([]);
  });

  it("adding something an admin already added returns it, and writes nothing", async () => {
    state.rows = [{ kind: "account", value: "tiktok", label: "TikTok" }];
    const res = await post({ kind: "account", label: "tiktok" });
    expect((await res.json()).data).toMatchObject({ value: "tiktok", created: false });
    expect(state.inserted).toEqual([]);
  });

  it("two admins adding the same option at once: the second is not an error", async () => {
    state.insertError = { code: "23505" };
    const res = await post({ kind: "account", label: "Viber" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ value: "viber", created: false });
  });

  it("a failed write is a 500, not a silent success", async () => {
    state.insertError = { code: "XX000" };
    expect((await post({ kind: "account", label: "Viber" })).status).toBe(500);
  });
});
