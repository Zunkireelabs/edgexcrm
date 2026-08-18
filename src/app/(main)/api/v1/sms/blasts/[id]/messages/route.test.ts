import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// docs/SMS-PHASE4-BRIEF.md item 2 — a blast can hold ~16k rows, so this route
// must always paginate, never load-everything.

const requireSmsAccessMock = vi.fn();
vi.mock("@/lib/sms/api-guard", () => ({ requireSmsAccess: requireSmsAccessMock }));

const params = Promise.resolve({ id: "blast-1" });

function fakeReq(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function fakeDb(rows: Record<string, unknown>[], total: number) {
  const rangeCalls: { from: number; to: number }[] = [];
  return {
    db: {
      from(table: string) {
        if (table === "sms_blasts") {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "blast-1" }, error: null }) }) }) };
        }
        if (table === "sms_messages") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: (from: number, to: number) => {
                    rangeCalls.push({ from, to });
                    return Promise.resolve({ data: rows, error: null, count: total });
                  },
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
    rangeCalls,
  };
}

describe("GET /api/v1/sms/blasts/[id]/messages", () => {
  beforeEach(() => {
    requireSmsAccessMock.mockReset();
  });

  it("paginates rather than loading the whole blast", async () => {
    const fake = fakeDb([{ id: "m1" }], 16000);
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: {}, db: fake.db });
    const { GET } = await import("./route");

    const res = await GET(fakeReq("http://x/api/v1/sms/blasts/blast-1/messages?page=3&pageSize=50"), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fake.rangeCalls).toEqual([{ from: 100, to: 149 }]);
    expect(json.meta).toMatchObject({ page: 3, pageSize: 50, total: 16000, totalPages: 320 });
  });

  it("clamps pageSize to the 200 ceiling", async () => {
    const fake = fakeDb([], 0);
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: {}, db: fake.db });
    const { GET } = await import("./route");

    await GET(fakeReq("http://x/api/v1/sms/blasts/blast-1/messages?pageSize=999999"), { params });
    expect(fake.rangeCalls[0]).toEqual({ from: 0, to: 199 });
  });

  it("404s for a blast that does not exist or isn't visible to this tenant", async () => {
    requireSmsAccessMock.mockResolvedValue({
      ok: true,
      auth: {},
      db: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) },
    });
    const { GET } = await import("./route");

    const res = await GET(fakeReq("http://x/api/v1/sms/blasts/blast-1/messages"), { params });
    expect(res.status).toBe(404);
  });

  it("returns the guard's response unchanged when access is denied", async () => {
    const denied = new Response(null, { status: 403 });
    requireSmsAccessMock.mockResolvedValue({ ok: false, response: denied });
    const { GET } = await import("./route");

    const res = await GET(fakeReq("http://x/api/v1/sms/blasts/blast-1/messages"), { params });
    expect(res.status).toBe(403);
  });
});
