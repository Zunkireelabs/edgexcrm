import { describe, it, expect, vi, beforeEach } from "vitest";

// PATCH/DELETE /api/v1/inbox/channels/[id] — admin-only, tenant-scoped channel updates/removal.

const auth = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

const encryptTokenMock = vi.hoisted(() => vi.fn((plaintext: string) => `encrypted:${plaintext}`));
vi.mock("@/lib/inbox/crypto", () => ({
  encryptToken: encryptTokenMock,
}));

const state = vi.hoisted(() => ({
  existingChannel: { id: "chan-1" } as Record<string, unknown> | null,
  updateResult: { data: null as Record<string, unknown> | null, error: null as unknown },
  conversationsDeleteError: null as unknown,
  channelDeleteError: null as unknown,
  lastUpdatePatch: null as unknown,
  deletedConversationsFilter: null as unknown,
  deletedChannelFilter: null as unknown,
}));

function queryBuilder(table: string) {
  return {
    select: () => ({
      eq: (_col: string, _val: string) => ({
        maybeSingle: async () => ({ data: table === "inbox_channels" ? state.existingChannel : null }),
      }),
    }),
    update: (patch: unknown) => {
      state.lastUpdatePatch = patch;
      return {
        eq: () => ({
          select: () => ({
            single: async () => state.updateResult,
          }),
        }),
      };
    },
    delete: () => ({
      eq: (col: string, val: string) => {
        if (table === "conversations") {
          state.deletedConversationsFilter = { col, val };
          return Promise.resolve({ error: state.conversationsDeleteError });
        }
        state.deletedChannelFilter = { col, val };
        return Promise.resolve({ error: state.channelDeleteError });
      },
    }),
  };
}

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: (table: string) => queryBuilder(table),
  })),
}));

import { PATCH, DELETE } from "./route";

function patchReq(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof PATCH>[0];
}

function params(id = "chan-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  auth.current = {
    userId: "u-1",
    email: "admin@tenant.com",
    tenantId: "tenant-A",
    role: "admin",
    industryId: "it_agency",
  };
  encryptTokenMock.mockClear();
  state.existingChannel = { id: "chan-1" };
  state.updateResult = {
    data: { id: "chan-1", provider: "whatsapp", external_account_id: "123", display_name: "Main", status: "active", updated_at: "2026-10-04T00:00:00Z" },
    error: null,
  };
  state.conversationsDeleteError = null;
  state.channelDeleteError = null;
  state.lastUpdatePatch = null;
  state.deletedConversationsFilter = null;
  state.deletedChannelFilter = null;
});

describe("PATCH /api/v1/inbox/channels/[id]", () => {
  it("is admin-only", async () => {
    auth.current!.role = "counselor";
    const res = await PATCH(patchReq({ access_token: "new-token" }), params());
    expect(res.status).toBe(403);
  });

  it("encrypts the new token the same way POST does, and updates within the tenant scope", async () => {
    const res = await PATCH(patchReq({ access_token: "raw-secret-token" }), params());
    expect(res.status).toBe(200);
    expect(encryptTokenMock).toHaveBeenCalledWith("raw-secret-token");
    expect(state.lastUpdatePatch).toEqual({ access_token: "encrypted:raw-secret-token" });
  });

  it("can update display_name without touching the token", async () => {
    const res = await PATCH(patchReq({ display_name: "Renamed" }), params());
    expect(res.status).toBe(200);
    expect(encryptTokenMock).not.toHaveBeenCalled();
    expect(state.lastUpdatePatch).toEqual({ display_name: "Renamed" });
  });

  it("404s for a channel not in this tenant's scope", async () => {
    state.existingChannel = null;
    const res = await PATCH(patchReq({ access_token: "x" }), params());
    expect(res.status).toBe(404);
  });

  it("422s when neither field is provided", async () => {
    const res = await PATCH(patchReq({}), params());
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/v1/inbox/channels/[id]", () => {
  it("is admin-only", async () => {
    auth.current!.role = "counselor";
    const res = await DELETE({} as never, params());
    expect(res.status).toBe(403);
  });

  it("deletes the channel's conversations before the channel, so a channel with messages succeeds", async () => {
    const res = await DELETE({} as never, params());
    expect(res.status).toBe(200);
    expect(state.deletedConversationsFilter).toEqual({ col: "channel_id", val: "chan-1" });
    expect(state.deletedChannelFilter).toEqual({ col: "id", val: "chan-1" });
  });

  it("500s if clearing conversations fails, without attempting the channel delete", async () => {
    state.conversationsDeleteError = { message: "boom" };
    const res = await DELETE({} as never, params());
    expect(res.status).toBe(500);
    expect(state.deletedChannelFilter).toBeNull();
  });

  it("404s for a channel not in this tenant's scope", async () => {
    state.existingChannel = null;
    const res = await DELETE({} as never, params());
    expect(res.status).toBe(404);
  });
});
