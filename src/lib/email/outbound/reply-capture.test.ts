import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isReplyCaptureEnabled,
  provisionBulkReplyCapture,
  finalizeBulkReplyCapture,
  parseFromHeader,
  type ProvisionedReply,
  type SentReplyRecord,
} from "./reply-capture";
import type { ScopedClient } from "@/lib/supabase/scoped";

// In-memory fake of the scoped client. Records every call; no database, no network.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface FakeOpts {
  tenantInboundEnabled?: boolean;
  failInsertOn?: "email_threads" | "inbound_addresses";
  /** fail the Nth (1-based) insert into inbound_addresses */
  failAddressInsertNumber?: number;
}

function fakeDb(opts: FakeOpts = {}) {
  const calls: { table: string; op: string; payload?: Row | Row[]; filters: [string, unknown][] }[] = [];
  let addressInserts = 0;

  const db = {
    from(table: string) {
      const st = { op: "select", payload: undefined as Row | Row[] | undefined, filters: [] as [string, unknown][] };
      const done = () => {
        calls.push({ table, op: st.op, payload: st.payload, filters: st.filters });
        if (table === "tenant_email_settings") {
          return { data: { inbound_enabled: opts.tenantInboundEnabled ?? true }, error: null };
        }
        if (st.op === "insert" && table === "inbound_addresses") {
          addressInserts += 1;
          if (opts.failInsertOn === "inbound_addresses" || opts.failAddressInsertNumber === addressInserts) {
            return { data: null, error: { message: "address insert failed" } };
          }
        }
        if (st.op === "insert" && table === "email_threads" && opts.failInsertOn === "email_threads") {
          return { data: null, error: { message: "thread insert failed" } };
        }
        return { data: null, error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        insert: (p: Row | Row[]) => ((st.op = "insert"), (st.payload = p), b),
        update: (p: Row) => ((st.op = "update"), (st.payload = p), b),
        delete: () => ((st.op = "delete"), b),
        in: (c: string, v: unknown) => (st.filters.push([c, v]), b),
        eq: (c: string, v: unknown) => (st.filters.push([c, v]), b),
        maybeSingle: async () => done(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(done()).then(res, rej),
      };
      return b;
    },
  };
  return { db: db as unknown as ScopedClient, calls };
}

const ENV_KEYS = ["EDGEX_INBOUND_ENABLED", "INBOUND_TOKEN_SECRET", "INBOUND_EMAIL_DOMAINS", "INBOUND_ENV_MARKER"] as const;
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
  process.env.EDGEX_INBOUND_ENABLED = "true";
  process.env.INBOUND_TOKEN_SECRET = "test-secret";
  process.env.INBOUND_EMAIL_DOMAINS = "edgex.zunkireelabs.com";
  process.env.INBOUND_ENV_MARKER = "s";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

const msgs = (n: number, withLead = true) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, lead_id: withLead ? `lead-${i}` : null, subject: `Subject ${i}` }));

describe("isReplyCaptureEnabled", () => {
  it("is off — with NO query at all — when EDGEX_INBOUND_ENABLED is not 'true' (prod today)", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "false";
    const { db, calls } = fakeDb();
    expect(await isReplyCaptureEnabled(db)).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("is off when the tenant has inbound disabled", async () => {
    const { db } = fakeDb({ tenantInboundEnabled: false });
    expect(await isReplyCaptureEnabled(db)).toBe(false);
  });
  it("is on only when both the env flag and the tenant setting are on", async () => {
    const { db } = fakeDb({ tenantInboundEnabled: true });
    expect(await isReplyCaptureEnabled(db)).toBe(true);
  });
});

describe("provisionBulkReplyCapture", () => {
  it("does nothing and runs no queries when the env flag is off", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "false";
    const { db, calls } = fakeDb();
    const out = await provisionBulkReplyCapture(db, msgs(5), "Admizz");
    expect(out.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("does nothing when no message has a lead (nobody to attach a reply to)", async () => {
    const { db, calls } = fakeDb();
    const out = await provisionBulkReplyCapture(db, msgs(3, false), "Admizz");
    expect(out.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("creates one thread + one token per message in BULK inserts (2 queries for 3 messages, not 6)", async () => {
    const { db, calls } = fakeDb();
    const out = await provisionBulkReplyCapture(db, msgs(3), "Admizz Education");
    expect(out.size).toBe(3);

    const inserts = calls.filter((c) => c.op === "insert");
    expect(inserts.map((c) => c.table)).toEqual(["email_threads", "inbound_addresses"]);
    const threads = inserts[0].payload as Row[];
    const addrs = inserts[1].payload as Row[];
    expect(threads).toHaveLength(3);
    expect(addrs).toHaveLength(3);
    expect(threads[0]).toMatchObject({ provider: "edgex_native", connected_email_account_id: null, message_count: 0, lead_id: "lead-0" });
    expect(addrs[0]).toMatchObject({ kind: "thread", verb: "reply", status: "active", user_id: null });
    // each token row points at its own thread
    expect(addrs.map((a) => a.thread_id)).toEqual(threads.map((t) => t.id));
  });

  it("maps each message to ITS OWN thread and a distinct, well-formed Reply-To", async () => {
    const { db, calls } = fakeDb();
    const out = await provisionBulkReplyCapture(db, msgs(3), "Admizz Education");
    const threads = calls.find((c) => c.table === "email_threads" && c.op === "insert")!.payload as Row[];
    const addrs = calls.find((c) => c.table === "inbound_addresses" && c.op === "insert")!.payload as Row[];

    const replyTos = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const p = out.get(`m${i}`) as ProvisionedReply;
      expect(p.threadId).toBe(threads[i].id);
      expect(p.leadId).toBe(`lead-${i}`);
      expect(p.replyTo).toMatch(/^"Admizz Education" <reply\+s[0-9a-f]{42}@edgex\.zunkireelabs\.com>$/);
      expect(p.replyTo).toContain(String(addrs[i].token)); // the stored token is the one in the address
      replyTos.add(p.replyTo);
    }
    expect(replyTos.size).toBe(3);
  });

  it("chunks large batches: 450 messages = 3 chunks = 6 inserts, never one query per message", async () => {
    const { db, calls } = fakeDb();
    const out = await provisionBulkReplyCapture(db, msgs(450), "Admizz");
    expect(out.size).toBe(450);
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(6);
    expect(Math.max(...calls.filter((c) => c.op === "insert").map((c) => (c.payload as Row[]).length))).toBeLessThanOrEqual(200);
  });

  it("skips messages with no lead but still captures the others", async () => {
    const { db } = fakeDb();
    const mixed = [...msgs(2), { id: "no-lead", lead_id: null, subject: "x" }];
    const out = await provisionBulkReplyCapture(db, mixed, "Admizz");
    expect([...out.keys()].sort()).toEqual(["m0", "m1"]);
  });

  it("is all-or-nothing: a failure on the 2nd chunk deletes everything already created and returns an empty map", async () => {
    const { db, calls } = fakeDb({ failAddressInsertNumber: 2 });
    const out = await provisionBulkReplyCapture(db, msgs(300), "Admizz");
    expect(out.size).toBe(0);
    const deletes = calls.filter((c) => c.table === "email_threads" && c.op === "delete");
    expect(deletes.length).toBeGreaterThan(0);
    // all 300 provisional threads (both chunks, including the chunk whose token insert failed) are removed
    const deletedIds = deletes.flatMap((d) => d.filters.find(([c]) => c === "id")![1] as string[]);
    expect(deletedIds).toHaveLength(300);
  });

  it("never throws: a broken token codec (missing secret) falls back to an empty map", async () => {
    delete process.env.INBOUND_TOKEN_SECRET;
    const { db } = fakeDb();
    await expect(provisionBulkReplyCapture(db, msgs(2), "Admizz")).resolves.toEqual(new Map());
  });
});

describe("finalizeBulkReplyCapture", () => {
  const provisioned = (n: number) => {
    const map = new Map<string, ProvisionedReply>();
    for (let i = 0; i < n; i++) {
      map.set(`m${i}`, { threadId: `t${i}`, replyTo: `r${i}`, leadId: `lead-${i}`, subject: `S${i}` });
    }
    return map;
  };
  const record = (p: ProvisionedReply): SentReplyRecord => ({
    provisioned: p,
    bodyHtml: "<p>hi</p>",
    toEmail: "lead@x.com",
    fromAddress: "hello@mail.admizz.com",
    fromName: "Admizz Education",
    providerMessageId: "resend-1",
  });

  it("is a no-op (no queries) when nothing was provisioned — i.e. whenever capture is off", async () => {
    const { db, calls } = fakeDb();
    await finalizeBulkReplyCapture(db, new Map(), new Map());
    expect(calls).toHaveLength(0);
  });

  it("marks sent threads as having 1 message and records the outbound email on each", async () => {
    const { db, calls } = fakeDb();
    const prov = provisioned(2);
    await finalizeBulkReplyCapture(db, prov, new Map([["m0", record(prov.get("m0")!)], ["m1", record(prov.get("m1")!)]]));

    const upd = calls.find((c) => c.table === "email_threads" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ message_count: 1 });
    expect(upd.filters).toContainEqual(["id", ["t0", "t1"]]);

    const emails = calls.find((c) => c.table === "emails" && c.op === "insert")!.payload as Row[];
    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      thread_id: "t0",
      direction: "outbound",
      provider: "resend",
      provider_message_id: "resend-1",
      from_email: "hello@mail.admizz.com",
      to_emails: ["lead@x.com"],
      subject: "S0",
      sender_user_id: null,
      gmail_message_id: null,
      rfc_message_id: "<resend-1@resend.edgex.invalid>", // NOT NULL column (migration 025) — must never be null
    });
    for (const e of emails) {
      for (const col of ["thread_id", "direction", "from_email", "rfc_message_id", "to_emails", "cc_emails", "bcc_emails", "rfc_references", "provider"]) {
        expect(e[col], `emails.${col} must not be null`).not.toBeNull();
        expect(e[col], `emails.${col} must be set`).not.toBeUndefined();
      }
    }
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("deletes the provisional thread (and so its token) of a message that did NOT go out", async () => {
    const { db, calls } = fakeDb();
    const prov = provisioned(3);
    await finalizeBulkReplyCapture(db, prov, new Map([["m1", record(prov.get("m1")!)]]));

    const del = calls.find((c) => c.table === "email_threads" && c.op === "delete")!;
    expect(del.filters).toContainEqual(["id", ["t0", "t2"]]);
    const upd = calls.find((c) => c.table === "email_threads" && c.op === "update")!;
    expect(upd.filters).toContainEqual(["id", ["t1"]]);
  });

  it("never throws even if every write fails", async () => {
    const { db } = fakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from = () => {
      throw new Error("db down");
    };
    const prov = provisioned(1);
    await expect(finalizeBulkReplyCapture(db, prov, new Map([["m0", record(prov.get("m0")!)]]))).resolves.toBeUndefined();
  });
});

describe("parseFromHeader", () => {
  it("splits a Name <addr> From header", () => {
    expect(parseFromHeader("Admizz Education <hello@mail.admizz.com>")).toEqual({
      address: "hello@mail.admizz.com",
      name: "Admizz Education",
    });
  });
  it("handles a bare address", () => {
    expect(parseFromHeader("noreply@edgex.zunkireelabs.com")).toEqual({ address: "noreply@edgex.zunkireelabs.com", name: "" });
  });
});
