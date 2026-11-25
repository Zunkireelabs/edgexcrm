import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// GET /inbox/pending-claims — which website chats the pop-up should offer right now.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
let rows: Row[];
let filters: { method: string; args: unknown[] }[];
let fail: boolean;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        order: () => b,
        limit: (...a: unknown[]) => (filters.push({ method: "limit", args: a }), b),
        eq: (...a: unknown[]) => (filters.push({ method: "eq", args: a }), b),
        in: (...a: unknown[]) => (filters.push({ method: "in", args: a }), b),
        or: (...a: unknown[]) => (filters.push({ method: "or", args: a }), b),
        gte: (...a: unknown[]) => (filters.push({ method: "gte", args: a }), b),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(fail ? { data: null, error: { message: "db down" } } : { data: rows, error: null }).then(res, rej),
      };
      return b;
    },
  }),
}));

import { GET } from "./route";

const AUTH = (nav: string[] | null): AuthContext =>
  ({ userId: "u1", tenantId: "tenant-a", role: "staff", permissions: { allowedNavKeys: nav === null ? null : new Set(nav) } }) as unknown as AuthContext;

beforeEach(() => {
  filters = [];
  fail = false;
  rows = [{ id: "c1", contact_display_name: "Ram Sharma", contact_phone: null, last_message_preview: "Hi", last_message_at: "2026-11-24T10:00:00Z", last_message_direction: "inbound", ai_autonomy: "off", meta: {} }];
  authMock.mockReset().mockResolvedValue(AUTH(null));
});

describe("GET /inbox/pending-claims", () => {
  it("401s without a session and 403s someone who can't open the Inbox", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    authMock.mockResolvedValue(AUTH(["/leads"]));
    expect((await GET()).status).toBe(403);
  });

  it("returns the waiting chats", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      { id: "c1", contact_display_name: "Ram Sharma", contact_phone: null, last_message_preview: "Hi", last_message_at: "2026-11-24T10:00:00Z", ai_replying: false, needs_human: false },
    ]);
  });

  it("only asks for open website chats nobody owns, in this tenant", async () => {
    await GET();
    expect(filters).toContainEqual({ method: "eq", args: ["tenant_id", "tenant-a"] });
    expect(filters).toContainEqual({ method: "eq", args: ["status", "open"] });
    expect(filters).toContainEqual({ method: "in", args: ["provider", ["chatwoot"]] });
    expect(filters).toContainEqual({ method: "or", args: ["assignee_type.eq.unassigned,and(assignee_type.eq.human,assigned_to_user_id.is.null)"] });
  });

  it("a chat a teammate answered is not offered, but one the AI answered still is (nobody human has it)", async () => {
    const base = { contact_display_name: null, contact_phone: null, last_message_preview: "x", last_message_at: "2026-11-24T10:00:00Z", meta: {} };
    rows = [
      { ...base, id: "visitor-last", last_message_direction: "inbound", ai_autonomy: "off" },
      { ...base, id: "ai-answered", last_message_direction: "outbound", ai_autonomy: "autonomous" },
      { ...base, id: "quiet-after-reply", last_message_direction: "outbound", ai_autonomy: "off" },
    ];
    const ids = ((await (await GET()).json()).data as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual(["visitor-last", "ai-answered"]);
    // the "nobody owns it" database filter is still what keeps teammate-owned chats out
    expect(filters).toContainEqual({ method: "or", args: ["assignee_type.eq.unassigned,and(assignee_type.eq.human,assigned_to_user_id.is.null)"] });
  });

  it("flags chats the AI handed over and lists them first, even though the AI's hand-off message was the last one", async () => {
    const base = { contact_display_name: null, contact_phone: null, last_message_preview: "x", last_message_at: "2026-11-24T10:00:00Z" };
    rows = [
      { ...base, id: "newest", last_message_direction: "inbound", ai_autonomy: "off", meta: {} },
      { ...base, id: "handed-over", last_message_direction: "outbound", ai_autonomy: "off", meta: { needs_human: { at: "2026-11-24T09:00:00Z", reason: "out_of_knowledge" } } },
    ];
    const cards = (await (await GET()).json()).data as { id: string; needs_human: boolean; ai_replying: boolean }[];
    expect(cards.map((c) => c.id)).toEqual(["handed-over", "newest"]);
    expect(cards[0]).toMatchObject({ needs_human: true, ai_replying: false });
  });

  it("only chats from the last 24 hours, so old never-accepted chats don't all pop up the day this ships", async () => {
    const before = Date.now();
    await GET();
    const gte = filters.find((f) => f.method === "gte")!;
    expect(gte.args[0]).toBe("last_message_at");
    const cutoff = new Date(gte.args[1] as string).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(24 * 3_600_000 - 5_000);
    expect(before - cutoff).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
  });

  it("caps the list at 20 cards", async () => {
    rows = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, contact_display_name: null, contact_phone: null, last_message_preview: null, last_message_at: "2026-11-24T10:00:00Z", last_message_direction: "inbound", ai_autonomy: "off", meta: {} }));
    expect(((await (await GET()).json()).data as unknown[]).length).toBe(20);
  });

  it("a database error returns an empty list, never an error page (the pop-up just stays quiet)", async () => {
    fail = true;
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });
});
