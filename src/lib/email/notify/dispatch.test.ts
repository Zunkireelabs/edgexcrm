import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("../index", () => ({ getResendClient: vi.fn(() => null), EMAIL_FROM: "EdgeX <noreply@test>" }));
vi.mock("../outbound/transport", () => ({ getEmailTransportMode: vi.fn(() => "resend"), sendStubEmail: vi.fn() }));

import { dispatchNotificationEmail, type SendFn } from "./dispatch";
import type { NotificationEmailEvent, NotifyDb } from "./types";

type Row = { status: string; error?: string | null; provider_message_id?: string | null };

function makeDb(opts: { members?: string[]; emails?: Record<string, string | null>; ledger?: Map<string, Row>; ledgerInsertError?: { code?: string; message: string } }) {
  const ledger = opts.ledger ?? new Map<string, Row>();
  const members = opts.members ?? ["u1", "u2"];
  const emails = opts.emails ?? { u1: "a@x.com", u2: "b@x.com" };
  const tableChain = (table: string) => {
    const eqs: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => {
      eqs[col] = val;
      return chain;
    };
    chain.in = () => Promise.resolve({ data: members.map((user_id) => ({ user_id, role: "owner" })), error: null });
    chain.maybeSingle = () =>
      Promise.resolve({ data: table === "tenants" ? { id: "t1", name: "Admizz", primary_color: "#112233" } : null });
    chain.insert = (row: { event: string; entity_id: string; recipient_email: string; status: string }) => {
      if (opts.ledgerInsertError) return Promise.resolve({ error: opts.ledgerInsertError });
      const k = `${row.event}|${row.entity_id}|${row.recipient_email}`;
      if (ledger.has(k)) return Promise.resolve({ error: { code: "23505", message: "dup" } });
      ledger.set(k, { status: row.status });
      return Promise.resolve({ error: null });
    };
    chain.update = (patch: Row) => {
      const upd: Record<string, unknown> = {};
      const u: Record<string, unknown> = {};
      u.eq = (col: string, val: unknown) => {
        upd[col] = val;
        if (col === "recipient_email") {
          const k = `${upd.event}|${upd.entity_id}|${upd.recipient_email}`;
          ledger.set(k, { ...(ledger.get(k) ?? { status: "pending" }), ...patch });
          return Promise.resolve({ error: null });
        }
        return u;
      };
      return u;
    };
    return chain;
  };
  const db = {
    from: (table: string) => tableChain(table),
    auth: {
      admin: {
        getUserById: (id: string) => Promise.resolve({ data: { user: emails[id] ? { email: emails[id], user_metadata: {} } : null }, error: null }),
      },
    },
  } as unknown as NotifyDb;
  return { db, ledger };
}

const event: NotificationEmailEvent<{ id: string }, { tag: string }> = {
  id: "test_event",
  roles: ["owner", "admin"],
  tenantId: () => "t1",
  entityId: (p) => p.id,
  prepare: async () => ({ tag: "ctx" }),
  build: ({ recipient, context }) => ({ subject: `s-${context.tag}`, html: `<p>${recipient.email}</p>`, text: recipient.email }),
};
const ENTITY = "11111111-1111-1111-1111-111111111111";
const ok: SendFn = vi.fn(async () => ({ id: "msg-1", error: null }));

beforeEach(() => vi.clearAllMocks());

describe("dispatchNotificationEmail", () => {
  it("sends exactly one email per recipient (separate sends, never a shared To:) and records each as sent", async () => {
    const { db, ledger } = makeDb({});
    const send = vi.fn(async () => ({ id: "msg-1", error: null })) as unknown as SendFn;
    const r = await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    expect(r).toEqual({ sent: 2, failed: 0, duplicates: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const tos = (send as unknown as { mock: { calls: { to: string }[][] } }).mock.calls.map((c) => c[0].to).sort();
    expect(tos).toEqual(["a@x.com", "b@x.com"]);
    expect([...ledger.values()].every((row) => row.status === "sent" && row.provider_message_id === "msg-1")).toBe(true);
  });

  it("a second call for the same entity sends NOTHING (ledger unique key) — retries / double calls / races", async () => {
    const { db } = makeDb({});
    const send = vi.fn(async () => ({ id: "m", error: null })) as unknown as SendFn;
    await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    const again = await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    expect(again).toEqual({ sent: 0, failed: 0, duplicates: 2 });
    expect(send).toHaveBeenCalledTimes(2); // still only the first two
  });

  it("a different entity is a different alert", async () => {
    const { db } = makeDb({});
    const send = vi.fn(async () => ({ id: "m", error: null })) as unknown as SendFn;
    await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    const other = await dispatchNotificationEmail(event, { id: "22222222-2222-2222-2222-222222222222" }, { db, send });
    expect(other.sent).toBe(2);
  });

  it("one recipient failing does not stop the others, never throws, and is recorded as failed with the reason", async () => {
    const { db, ledger } = makeDb({});
    const send = vi.fn(async (a: { to: string }) => (a.to === "a@x.com" ? { id: null, error: "mailbox full" } : { id: "ok", error: null })) as unknown as SendFn;
    const r = await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    expect(r).toEqual({ sent: 1, failed: 1, duplicates: 0 });
    expect(ledger.get(`test_event|${ENTITY}|a@x.com`)).toMatchObject({ status: "failed", error: "mailbox full" });
    expect(ledger.get(`test_event|${ENTITY}|b@x.com`)).toMatchObject({ status: "sent" });
  });

  it("a send that throws is caught and recorded as failed", async () => {
    const { db, ledger } = makeDb({ members: ["u1"] });
    const send = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as SendFn;
    await expect(dispatchNotificationEmail(event, { id: ENTITY }, { db, send })).resolves.toMatchObject({ sent: 0, failed: 1 });
    expect(ledger.get(`test_event|${ENTITY}|a@x.com`)).toMatchObject({ status: "failed", error: "network down" });
  });

  it("'sent' only when the provider returns a message id — an empty success is a failure, not optimistic", async () => {
    const { db, ledger } = makeDb({ members: ["u1"] });
    const send = vi.fn(async () => ({ id: null, error: null })) as unknown as SendFn;
    const r = await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    expect(r.failed).toBe(1);
    expect(ledger.get(`test_event|${ENTITY}|a@x.com`)?.status).toBe("failed");
  });

  it("fails CLOSED: if the ledger can't be written, nothing is sent", async () => {
    const { db } = makeDb({ ledgerInsertError: { message: "relation does not exist" } });
    const send = vi.fn(ok);
    const r = await dispatchNotificationEmail(event, { id: ENTITY }, { db, send });
    expect(send).not.toHaveBeenCalled();
    expect(r.failed).toBe(2);
  });

  it("sends nothing when the event says this occurrence is not eligible", async () => {
    const { db } = makeDb({});
    const send = vi.fn(ok);
    const r = await dispatchNotificationEmail({ ...event, prepare: async () => null }, { id: ENTITY }, { db, send });
    expect(r.skipped).toBe("not_eligible");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips quietly when there is nobody to notify", async () => {
    const { db } = makeDb({ members: ["u1"], emails: { u1: null } });
    const send = vi.fn(ok);
    expect((await dispatchNotificationEmail(event, { id: ENTITY }, { db, send })).skipped).toBe("no_recipients");
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws even when the event itself blows up", async () => {
    const { db } = makeDb({});
    const boom = { ...event, prepare: async () => { throw new Error("db down"); } };
    await expect(dispatchNotificationEmail(boom, { id: ENTITY }, { db, send: vi.fn(ok) })).resolves.toMatchObject({ skipped: "error" });
  });

  it("with real sending selected but no Resend key, skips without touching the ledger or throwing", async () => {
    const { db, ledger } = makeDb({});
    const r = await dispatchNotificationEmail(event, { id: ENTITY }, { db }); // no injected sender -> default (resend mode, no key)
    expect(r.skipped).toBe("email_not_configured");
    expect(ledger.size).toBe(0);
  });
});
