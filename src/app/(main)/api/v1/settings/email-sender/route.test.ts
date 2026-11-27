import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Company email sender settings: the original three fields plus the optional no-reply address and template colours. No database.

const state = vi.hoisted(() => ({
  authed: true,
  admin: true,
  rows: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
  upsertError: null as unknown,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => (state.authed ? { userId: "u1", tenantId: "t1", role: "admin" } : null)),
  requireAdmin: () => state.admin,
}));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({ from: () => ({ select: async () => ({ data: state.rows, error: null }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({
      upsert: (payload: Record<string, unknown>) => {
        state.upserts.push(payload);
        return { select: () => ({ single: async () => ({ data: { ...payload, domain_verified: true }, error: state.upsertError }) }) };
      },
    }),
  }),
}));

const put = async (body: unknown) => {
  const { PUT } = await import("./route");
  return PUT({ json: async () => body } as unknown as NextRequest);
};
const get = async () => (await import("./route")).GET();

const BASE = { from_name: "Admizz Education", from_address: "hello@mail.admizz.com", reply_to: "hello@admizz.com" };

beforeEach(() => {
  state.authed = true;
  state.admin = true;
  state.rows = [];
  state.upserts = [];
  state.upsertError = null;
});

describe("GET /api/v1/settings/email-sender", () => {
  it("returns the stored row including the no-reply address and colours", async () => {
    state.rows = [{ ...BASE, domain_verified: true, no_reply_address: "no-reply@mail.admizz.com", template_color: "#0D1282", template_accent: "#FDED22" }];
    const data = (await (await get()).json()).data;
    expect(data).toMatchObject({ no_reply_address: "no-reply@mail.admizz.com", template_color: "#0D1282", template_accent: "#FDED22" });
  });

  it("returns empty defaults for the new fields when nothing is stored yet", async () => {
    const data = (await (await get()).json()).data;
    expect(data).toMatchObject({ from_address: null, no_reply_address: null, template_color: null, template_accent: null });
  });
});

describe("PUT /api/v1/settings/email-sender: who may save", () => {
  it("401 signed out, 403 for anyone but an admin; nothing is written", async () => {
    state.authed = false;
    expect((await put(BASE)).status).toBe(401);
    state.authed = true;
    state.admin = false;
    expect((await put({ ...BASE, no_reply_address: "no-reply@mail.admizz.com" })).status).toBe(403);
    expect(state.upserts).toEqual([]);
  });
});

describe("PUT: the no-reply address", () => {
  const save = (extra: Record<string, unknown>) => put({ ...BASE, ...extra });
  const details = async (res: Response) => (await res.json()).error.details;

  it("saves a valid address on the same domain as the From address", async () => {
    const res = await save({ no_reply_address: "  no-reply@mail.admizz.com " });
    expect(res.status).toBe(200);
    expect(state.upserts[0]).toMatchObject({ tenant_id: "t1", no_reply_address: "no-reply@mail.admizz.com" });
  });

  it("compares the domain ignoring case", async () => {
    expect((await save({ no_reply_address: "No-Reply@MAIL.admizz.COM" })).status).toBe(200);
  });

  it("rejects an address on a DIFFERENT domain, naming the right one", async () => {
    const res = await save({ no_reply_address: "no-reply@other.com" });
    expect(res.status).toBe(422);
    expect((await details(res)).no_reply_address[0]).toContain("@mail.admizz.com");
    expect(state.upserts).toEqual([]);
  });

  it("rejects a lookalike domain (the same text with something added)", async () => {
    expect((await save({ no_reply_address: "no-reply@mail.admizz.com.evil.io" })).status).toBe(422);
    expect((await save({ no_reply_address: "no-reply@xmail.admizz.com" })).status).toBe(422);
  });

  it("rejects something that is not an email", async () => {
    const res = await save({ no_reply_address: "no-reply" });
    expect(res.status).toBe(422);
    expect((await details(res)).no_reply_address).toBeDefined();
  });

  it("rejects the very same address as the From address", async () => {
    expect((await save({ no_reply_address: "HELLO@mail.admizz.com" })).status).toBe(422);
  });

  it("needs a From address to compare with", async () => {
    const res = await put({ from_name: "X", reply_to: null, from_address: null, no_reply_address: "no-reply@mail.admizz.com" });
    expect(res.status).toBe(422);
    expect((await details(res)).no_reply_address[0]).toContain("From address");
  });

  it("an empty value clears it", async () => {
    expect((await save({ no_reply_address: "" })).status).toBe(200);
    expect(state.upserts[0]).toMatchObject({ no_reply_address: null });
    expect((await save({ no_reply_address: null })).status).toBe(200);
    expect(state.upserts[1]).toMatchObject({ no_reply_address: null });
  });
});

describe("PUT: the template colours", () => {
  it("saves valid colours, upper-cased", async () => {
    const res = await put({ ...BASE, template_color: "#0d1282", template_accent: " #fded22 " });
    expect(res.status).toBe(200);
    expect(state.upserts[0]).toMatchObject({ template_color: "#0D1282", template_accent: "#FDED22" });
  });

  it.each(["red", "#12", "#12345G", "#0D1282; background:url(x)", "0D1282", "#0D12"])("rejects %s", async (bad) => {
    const res = await put({ ...BASE, template_color: bad });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.template_color).toBeDefined();
    expect(state.upserts).toEqual([]);
  });

  it("rejects a bad accent colour too", async () => {
    const res = await put({ ...BASE, template_accent: "yellow" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.template_accent).toBeDefined();
  });

  it("empty clears them", async () => {
    await put({ ...BASE, template_color: "", template_accent: null });
    expect(state.upserts[0]).toMatchObject({ template_color: null, template_accent: null });
  });
});

describe("PUT: an older client that only knows the original three fields cannot wipe the new ones", () => {
  it("leaves no_reply_address / template_color / template_accent OUT of the write when the request does not carry them", async () => {
    const res = await put(BASE);
    expect(res.status).toBe(200);
    const payload = state.upserts[0];
    expect(payload).toMatchObject({ from_name: "Admizz Education", from_address: "hello@mail.admizz.com", reply_to: "hello@admizz.com" });
    expect(payload).not.toHaveProperty("no_reply_address");
    expect(payload).not.toHaveProperty("template_color");
    expect(payload).not.toHaveProperty("template_accent");
  });

  it("a failed write is a 503, not a silent success", async () => {
    state.upsertError = { message: "boom" };
    expect((await put(BASE)).status).toBe(503);
  });
});
