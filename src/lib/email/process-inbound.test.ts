import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Generic in-memory chainable/thenable Supabase-shaped query builder ──────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function makeQueryBuilder(
  rows: Row[],
  opts: { mode: "select" | "insert" | "update"; payload?: Row; forceError?: { code: string; message: string } },
) {
  const filters: Array<[string, unknown]> = [];
  let limitN: number | null = null;

  function matches(r: Row) {
    return filters.every(([k, v]) => r[k] === v);
  }

  function computeResult(): { data: unknown; error: unknown } {
    if (opts.forceError) return { data: null, error: opts.forceError };

    if (opts.mode === "insert") {
      const created = { id: `generated-${rows.length + 1}`, ...opts.payload };
      rows.push(created);
      return { data: created, error: null };
    }
    if (opts.mode === "update") {
      const matched = rows.filter(matches);
      matched.forEach((r) => Object.assign(r, opts.payload));
      return { data: matched, error: null };
    }
    let result = rows.filter(matches);
    if (limitN != null) result = result.slice(0, limitN);
    return { data: result, error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) {
      filters.push([col, val]);
      return builder;
    },
    order() {
      return builder;
    },
    limit(n: number) {
      limitN = n;
      return builder;
    },
    select() {
      return builder;
    },
    maybeSingle: async () => {
      const { data, error } = computeResult();
      const arr = Array.isArray(data) ? data : [data];
      return { data: arr[0] ?? null, error };
    },
    single: async () => {
      const { data, error } = computeResult();
      const arr = Array.isArray(data) ? data : [data];
      return { data: arr[0] ?? null, error };
    },
    then(resolve: (v: { data: unknown; error: unknown }) => void, reject?: (e: unknown) => void) {
      Promise.resolve(computeResult()).then(resolve, reject);
    },
  };
  return builder;
}

function makeClient(tables: Record<string, Row[]>, forceInsertErrors: Record<string, { code: string; message: string }> = {}) {
  const client = {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      return {
        select: () => makeQueryBuilder(rows, { mode: "select" }),
        insert: (payload: Row) => makeQueryBuilder(rows, { mode: "insert", payload, forceError: forceInsertErrors[table] }),
        update: (payload: Row) => makeQueryBuilder(rows, { mode: "update", payload }),
      };
    },
    raw() {
      return client;
    },
  };
  return client;
}

// ── Mocks ─────────────────────────────────────────────────────────────────

import type { EmailThreadRow } from "./inbound/match-thread";

let serviceTables: Record<string, Row[]>;
let scopedTables: Record<string, Row[]>;
let forceInsertErrors: Record<string, { code: string; message: string }>;

interface ReceivingFixture {
  object: "email";
  id: string;
  to: string[];
  from: string;
  created_at: string;
  subject: string;
  bcc: string[];
  cc: string[];
  reply_to: string | null;
  html: string;
  text: string;
  headers: Record<string, string>;
  message_id: string;
  attachments: unknown[];
}

interface LeadIdentityResult {
  match: "none" | "email" | "phone";
  existingLead: { id: string } | null;
  phoneMatchLeadIds: string[];
}

const getReceivingEmailMock = vi.fn(async (emailId: string): Promise<ReceivingFixture> => {
  void emailId;
  throw new Error("getReceivingEmailMock not configured for this test");
});
const forwardReceivingEmailMock = vi.fn(
  async (args: { emailId: string; to: string; from: string }): Promise<boolean> => {
    void args;
    return true;
  },
);
const matchInboundToThreadMock = vi.fn(
  async (supabase: unknown, params: unknown): Promise<EmailThreadRow | null> => {
    void supabase;
    void params;
    return null;
  },
);
const resolveLeadIdentityMock = vi.fn(
  async (supabase: unknown, params: unknown): Promise<LeadIdentityResult> => {
    void supabase;
    void params;
    return { match: "none", existingLead: null, phoneMatchLeadIds: [] };
  },
);
const emitEventMock = vi.fn(async (params: unknown): Promise<string> => {
  void params;
  return "event-id";
});
interface ThreadNotificationParams {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}

const upsertThreadNotificationMock = vi.fn(async (params: ThreadNotificationParams): Promise<void> => {
  void params;
});

interface BccDropboxCallArgs {
  tenantId: string;
  resendEmailId: string;
  userId: string | null;
}
const processBccDropboxMock = vi.fn(async (params: BccDropboxCallArgs, ...rest: unknown[]): Promise<void> => {
  void params;
  void rest;
});

interface FwdRelayCallArgs {
  tenantId: string;
  resendEmailId: string;
  inboundAddressId: string;
}
const processFwdRelayMock = vi.fn(async (params: FwdRelayCallArgs, ...rest: unknown[]): Promise<void> => {
  void params;
  void rest;
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => makeClient(serviceTables, forceInsertErrors)),
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: vi.fn(async () => makeClient(scopedTables, forceInsertErrors)),
}));

vi.mock("./inbound/resend-client", () => ({
  getReceivingEmail: (emailId: string) => getReceivingEmailMock(emailId),
  forwardReceivingEmail: (args: { emailId: string; to: string; from: string }) =>
    forwardReceivingEmailMock(args),
}));

vi.mock("./inbound/match-thread", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inbound/match-thread")>();
  return {
    ...actual,
    matchInboundToThread: (supabase: unknown, params: unknown) => matchInboundToThreadMock(supabase, params),
  };
});

vi.mock("@/lib/leads/dedup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/dedup")>();
  return {
    ...actual,
    resolveLeadIdentity: (supabase: unknown, params: unknown) => resolveLeadIdentityMock(supabase, params),
  };
});

vi.mock("@/lib/api/audit", () => ({
  emitEvent: (params: unknown) => emitEventMock(params),
}));

vi.mock("@/lib/notifications", () => ({
  upsertThreadNotification: (params: ThreadNotificationParams) => upsertThreadNotificationMock(params),
  NotificationTypes: { EMAIL_RECEIVED: "email.received" },
}));

// This test file's job is the DISPATCH branch only (verb='bcc' -> delegate,
// full stop) — the dropbox algorithm itself is unit-tested in isolation in
// ./inbound/bcc-route.test.ts against its own harness.
vi.mock("./inbound/bcc-route", () => ({
  processBccDropbox: (params: BccDropboxCallArgs, ...rest: unknown[]) => processBccDropboxMock(params, ...rest),
}));

// Same rationale as bcc-route above — the fwd relay algorithm itself is
// unit-tested in isolation in ./inbound/fwd-route.test.ts.
vi.mock("./inbound/fwd-route", () => ({
  processFwdRelay: (params: FwdRelayCallArgs, ...rest: unknown[]) => processFwdRelayMock(params, ...rest),
}));

import { processInboundEmailEvents } from "./process-inbound";

const BASE_RECEIVING = {
  object: "email" as const,
  id: "resend-1",
  to: ["reply+abcdef@inbound.edgex.zunkireelabs.com"],
  from: '"Hardik B" <hardik@example.com>',
  created_at: "2026-07-28T10:00:00.000Z",
  subject: "Re: Application status",
  bcc: [] as string[],
  cc: [] as string[],
  reply_to: null,
  html: "<p>Thanks!</p>",
  text: "Thanks!",
  headers: { "Message-ID": "<reply-msg-1@example.com>" } as Record<string, string>,
  message_id: "<reply-msg-1@example.com>",
  attachments: [] as unknown[],
};

function makeEvent(payload: Row) {
  return {
    id: "evt-1",
    tenant_id: payload.tenant_id,
    type: "email.inbound_received",
    status: "pending",
    attempts: 0,
    payload,
  };
}

beforeEach(() => {
  process.env.INBOUND_EMAIL_DOMAINS = "inbound.edgex.zunkireelabs.com";
  process.env.INBOUND_ENV_MARKER = "l";
  process.env.INBOUND_TOKEN_SECRET = "a".repeat(64);
  serviceTables = {};
  scopedTables = {};
  forceInsertErrors = {};
  getReceivingEmailMock.mockReset().mockResolvedValue(BASE_RECEIVING);
  forwardReceivingEmailMock.mockReset().mockResolvedValue(true);
  matchInboundToThreadMock.mockReset().mockResolvedValue(null);
  resolveLeadIdentityMock.mockReset().mockResolvedValue({ match: "none", existingLead: null, phoneMatchLeadIds: [] });
  emitEventMock.mockReset().mockResolvedValue("event-id");
  upsertThreadNotificationMock.mockReset().mockResolvedValue(undefined);
  processBccDropboxMock.mockReset().mockResolvedValue(undefined);
  processFwdRelayMock.mockReset().mockResolvedValue(undefined);
});

describe("processInboundEmailEvents — happy path (verb=reply, thread_id, authoritative)", () => {
  it("inserts the inbound email, bumps the thread, emits + notifies + forwards", async () => {
    scopedTables.email_threads = [
      { id: "thread-1", tenant_id: "tenant-a", connected_email_account_id: "acct-1", gmail_thread_id: "gm-1", lead_id: "lead-1", contact_id: null, message_count: 3 },
    ];
    scopedTables.connected_email_accounts = [{ id: "acct-1", tenant_id: "tenant-a", user_id: "user-1", email: "rep@gmail.com" }];
    scopedTables.leads = [{ id: "lead-1", tenant_id: "tenant-a", assigned_to: "user-2" }];

    serviceTables.events = [
      makeEvent({
        resend_email_id: "resend-1",
        tenant_id: "tenant-a",
        inbound_address_id: "addr-1",
        kind: "thread",
        verb: "reply",
        thread_id: "thread-1",
        user_id: null,
        envelope: { to: BASE_RECEIVING.to, cc: [], bcc: [], from: BASE_RECEIVING.from, subject: BASE_RECEIVING.subject },
      }),
    ];

    const result = await processInboundEmailEvents();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(matchInboundToThreadMock).not.toHaveBeenCalled(); // authoritative path skips the fallback matcher

    expect(scopedTables.emails).toHaveLength(1);
    expect(scopedTables.emails[0]).toMatchObject({
      thread_id: "thread-1",
      direction: "inbound",
      provider: "edgex_native",
      provider_message_id: "resend-1",
      from_email: "hardik@example.com",
      from_name: "Hardik B",
    });

    expect(scopedTables.email_threads[0].message_count).toBe(4);

    expect(emitEventMock).toHaveBeenCalledTimes(1);
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", type: "email.received" }));

    expect(upsertThreadNotificationMock).toHaveBeenCalledTimes(2);
    const notifiedUsers = upsertThreadNotificationMock.mock.calls.map((c) => c[0].userId).sort();
    expect(notifiedUsers).toEqual(["user-1", "user-2"]);

    expect(forwardReceivingEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: "resend-1", to: "rep@gmail.com" }),
    );

    expect(serviceTables.events[0].status).toBe("completed");
  });
});

describe("processInboundEmailEvents — passthrough-forward from: (REPLYABLE-FORWARD-BRIEF Stage 2 §a)", () => {
  it("mints a thread-bound fwd+ token and forwards from it (not the bare platform address)", async () => {
    scopedTables.email_threads = [
      { id: "thread-1", tenant_id: "tenant-a", connected_email_account_id: "acct-1", gmail_thread_id: "gm-1", lead_id: "lead-1", contact_id: null, message_count: 3 },
    ];
    scopedTables.connected_email_accounts = [{ id: "acct-1", tenant_id: "tenant-a", user_id: "user-1", email: "rep@gmail.com" }];
    scopedTables.leads = [{ id: "lead-1", tenant_id: "tenant-a", assigned_to: "user-2" }];

    serviceTables.events = [
      makeEvent({
        resend_email_id: "resend-1",
        tenant_id: "tenant-a",
        inbound_address_id: "addr-1",
        kind: "thread",
        verb: "reply",
        thread_id: "thread-1",
        user_id: null,
        envelope: { to: BASE_RECEIVING.to, cc: [], bcc: [], from: BASE_RECEIVING.from, subject: BASE_RECEIVING.subject },
      }),
    ];

    await processInboundEmailEvents();

    expect(scopedTables.inbound_addresses).toHaveLength(1);
    expect(scopedTables.inbound_addresses[0]).toMatchObject({ kind: "thread", verb: "fwd", thread_id: "thread-1", status: "active" });

    const call = forwardReceivingEmailMock.mock.calls[0][0] as { from: string };
    expect(call.from).toContain("fwd+");
    expect(call.from).not.toBe("noreply@lead-crm.zunkireelabs.com");
  });

  it("reuses an existing active fwd token for the thread instead of minting a second one", async () => {
    scopedTables.email_threads = [
      { id: "thread-1", tenant_id: "tenant-a", connected_email_account_id: "acct-1", gmail_thread_id: "gm-1", lead_id: "lead-1", contact_id: null, message_count: 3 },
    ];
    scopedTables.connected_email_accounts = [{ id: "acct-1", tenant_id: "tenant-a", user_id: "user-1", email: "rep@gmail.com" }];
    scopedTables.leads = [{ id: "lead-1", tenant_id: "tenant-a", assigned_to: "user-2" }];
    scopedTables.inbound_addresses = [
      { id: "existing-fwd", tenant_id: "tenant-a", kind: "thread", verb: "fwd", token: "existingtoken1234567890existingtoken12", thread_id: "thread-1", status: "active" },
    ];

    serviceTables.events = [
      makeEvent({
        resend_email_id: "resend-1",
        tenant_id: "tenant-a",
        inbound_address_id: "addr-1",
        kind: "thread",
        verb: "reply",
        thread_id: "thread-1",
        user_id: null,
        envelope: { to: BASE_RECEIVING.to, cc: [], bcc: [], from: BASE_RECEIVING.from, subject: BASE_RECEIVING.subject },
      }),
    ];

    await processInboundEmailEvents();

    expect(scopedTables.inbound_addresses).toHaveLength(1); // no new row minted
    const call = forwardReceivingEmailMock.mock.calls[0][0] as { from: string };
    expect(call.from).toContain("existingtoken1234567890existingtoken12");
  });
});

describe("processInboundEmailEvents — loop/auto guard", () => {
  it("dead-letters an Auto-Submitted message before any write, and never emits", async () => {
    getReceivingEmailMock.mockResolvedValue({
      ...BASE_RECEIVING,
      headers: { "Auto-Submitted": "auto-replied" },
    });
    scopedTables.email_threads = [];

    serviceTables.events = [
      makeEvent({
        resend_email_id: "resend-1",
        tenant_id: "tenant-a",
        inbound_address_id: "addr-1",
        kind: "thread",
        verb: "reply",
        thread_id: null,
        user_id: null,
        envelope: { to: BASE_RECEIVING.to, cc: [], bcc: [], from: BASE_RECEIVING.from, subject: BASE_RECEIVING.subject },
      }),
    ];

    const result = await processInboundEmailEvents();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0]).toMatchObject({ tenant_id: "tenant-a", reason: "auto_submitted" });
    expect(scopedTables.emails ?? []).toHaveLength(0);
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("dead-letters when Precedence: bulk is present", async () => {
    getReceivingEmailMock.mockResolvedValue({ ...BASE_RECEIVING, headers: { Precedence: "bulk" } });
    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-a", inbound_address_id: "a1", kind: "thread", verb: "reply", thread_id: null, user_id: null, envelope: {} }),
    ];

    await processInboundEmailEvents();

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
  });

  it("dead-letters when the sender is the tenant's own automation from_address (self-loop)", async () => {
    getReceivingEmailMock.mockResolvedValue({ ...BASE_RECEIVING, from: "noreply@tenant-domain.com", headers: {} });
    scopedTables.tenant_email_settings = [{ from_address: "noreply@tenant-domain.com" }];
    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-a", inbound_address_id: "a1", kind: "thread", verb: "reply", thread_id: null, user_id: null, envelope: {} }),
    ];

    await processInboundEmailEvents();

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
  });
});

describe("processInboundEmailEvents — idempotency", () => {
  it("a 23505 unique violation on the emails insert is treated as already-processed, not an error", async () => {
    forceInsertErrors.emails = { code: "23505", message: "duplicate key" };
    scopedTables.email_threads = [
      { id: "thread-1", tenant_id: "tenant-a", connected_email_account_id: null, gmail_thread_id: null, lead_id: null, contact_id: null, message_count: 1 },
    ];
    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-a", inbound_address_id: "a1", kind: "thread", verb: "reply", thread_id: "thread-1", user_id: null, envelope: {} }),
    ];

    const result = await processInboundEmailEvents();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(emitEventMock).not.toHaveBeenCalled();
    // thread was not bumped since we returned before that point
    expect(scopedTables.email_threads[0].message_count).toBe(1);
  });
});

describe("processInboundEmailEvents — new-thread creation", () => {
  it("creates a new edgex_native thread and resolves lead_id via resolveLeadIdentity when no thread matches", async () => {
    matchInboundToThreadMock.mockResolvedValue(null);
    resolveLeadIdentityMock.mockResolvedValue({
      match: "email",
      existingLead: { id: "lead-42" },
      phoneMatchLeadIds: [],
    });

    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-a", inbound_address_id: "a1", kind: "tenant", verb: "reply", thread_id: null, user_id: null, envelope: {} }),
    ];

    const result = await processInboundEmailEvents();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(scopedTables.email_threads).toHaveLength(1);
    expect(scopedTables.email_threads[0]).toMatchObject({
      provider: "edgex_native",
      connected_email_account_id: null,
      gmail_thread_id: null,
      lead_id: "lead-42",
      subject: "Application status", // "Re: " prefix stripped
    });
    expect(scopedTables.emails[0].thread_id).toBe(scopedTables.email_threads[0].id);
  });

  it("leaves lead_id null when resolveLeadIdentity finds no single match", async () => {
    resolveLeadIdentityMock.mockResolvedValue({ match: "none", existingLead: null, phoneMatchLeadIds: ["lead-1", "lead-2"] });
    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-a", inbound_address_id: "a1", kind: "tenant", verb: "reply", thread_id: null, user_id: null, envelope: {} }),
    ];

    await processInboundEmailEvents();

    expect(scopedTables.email_threads[0].lead_id).toBeNull();
  });
});

describe("processInboundEmailEvents — tenant-scoped fallback matcher", () => {
  it("uses matchInboundToThread's result when thread_id is absent (verb='reply')", async () => {
    matchInboundToThreadMock.mockResolvedValue({
      id: "thread-existing",
      tenant_id: "tenant-a",
      message_count: 2,
      lead_id: null,
      contact_id: null,
      gmail_thread_id: null,
      connected_email_account_id: null,
    });

    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-a", inbound_address_id: "a1", kind: "tenant", verb: "reply", thread_id: null, user_id: null, envelope: {} }),
    ];

    await processInboundEmailEvents();

    expect(matchInboundToThreadMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: "tenant-a" }));
    // The matched thread is a mock stand-in (no physical row needed) — the
    // assertion that matters is that no NEW thread row got created for it.
    expect(scopedTables.email_threads ?? []).toHaveLength(0);
    expect(scopedTables.emails[0].thread_id).toBe("thread-existing");
  });
});

describe("processInboundEmailEvents — cross-tenant defense-in-depth", () => {
  it("throws (and the event is retried, not silently misrouted) if the reply-token thread belongs to a different tenant", async () => {
    scopedTables.email_threads = [
      { id: "victim-thread", tenant_id: "tenant-VICTIM", connected_email_account_id: null, gmail_thread_id: null, lead_id: null, contact_id: null, message_count: 1 },
    ];

    serviceTables.events = [
      makeEvent({ resend_email_id: "r1", tenant_id: "tenant-ATTACKER", inbound_address_id: "a1", kind: "thread", verb: "reply", thread_id: "victim-thread", user_id: null, envelope: {} }),
    ];

    const result = await processInboundEmailEvents();

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
    expect(serviceTables.events[0].status).toBe("pending"); // attempts=1, retried, not silently dropped
    expect(serviceTables.events[0].attempts).toBe(1);
    expect(scopedTables.emails ?? []).toHaveLength(0);
  });
});

describe("processInboundEmailEvents — verb='bcc' dispatch (BCC-DROPBOX-BRIEF §5)", () => {
  it("delegates to processBccDropbox and never touches the reply-path guard/thread logic", async () => {
    getReceivingEmailMock.mockResolvedValue({
      ...BASE_RECEIVING,
      to: ["bcc+s000markerxxxxxxchecksum@inbound.edgex.zunkireelabs.com"],
      headers: { "Message-ID": "<original@mail.gmail.com>" },
    });

    serviceTables.events = [
      makeEvent({
        resend_email_id: "resend-1",
        tenant_id: "tenant-a",
        inbound_address_id: "addr-1",
        kind: "user",
        verb: "bcc",
        thread_id: null,
        user_id: "user-9",
        envelope: { to: ["bcc+s000markerxxxxxxchecksum@inbound.edgex.zunkireelabs.com"], cc: [], bcc: [], from: BASE_RECEIVING.from, subject: BASE_RECEIVING.subject },
      }),
    ];

    const result = await processInboundEmailEvents();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });

    expect(processBccDropboxMock).toHaveBeenCalledTimes(1);
    expect(processBccDropboxMock.mock.calls[0][0]).toEqual({
      tenantId: "tenant-a",
      resendEmailId: "resend-1",
      userId: "user-9",
    });

    // The reply-path machinery below the dispatch branch must never run for a
    // bcc event — this is what proves the branch is a full stop, not a
    // fallthrough.
    expect(matchInboundToThreadMock).not.toHaveBeenCalled();
    expect(resolveLeadIdentityMock).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
    expect(forwardReceivingEmailMock).not.toHaveBeenCalled();
    expect(upsertThreadNotificationMock).not.toHaveBeenCalled();
    expect(scopedTables.email_threads ?? []).toHaveLength(0);
    expect(scopedTables.emails ?? []).toHaveLength(0);

    expect(serviceTables.events[0].status).toBe("completed");
  });
});

describe("processInboundEmailEvents — verb='fwd' dispatch (REPLYABLE-FORWARD-BRIEF Stage 2)", () => {
  it("delegates to processFwdRelay and never touches the reply-path guard/thread logic", async () => {
    serviceTables.events = [
      makeEvent({
        resend_email_id: "resend-1",
        tenant_id: "tenant-a",
        inbound_address_id: "addr-fwd-1",
        kind: "thread",
        verb: "fwd",
        thread_id: "thread-1",
        user_id: null,
        envelope: { to: [], cc: [], bcc: [], from: BASE_RECEIVING.from, subject: BASE_RECEIVING.subject },
      }),
    ];

    const result = await processInboundEmailEvents();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });

    expect(processFwdRelayMock).toHaveBeenCalledTimes(1);
    expect(processFwdRelayMock.mock.calls[0][0]).toEqual({
      tenantId: "tenant-a",
      resendEmailId: "resend-1",
      inboundAddressId: "addr-fwd-1",
    });

    expect(matchInboundToThreadMock).not.toHaveBeenCalled();
    expect(resolveLeadIdentityMock).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
    expect(forwardReceivingEmailMock).not.toHaveBeenCalled();
    expect(upsertThreadNotificationMock).not.toHaveBeenCalled();
    expect(scopedTables.email_threads ?? []).toHaveLength(0);
    expect(scopedTables.emails ?? []).toHaveLength(0);

    expect(serviceTables.events[0].status).toBe("completed");
  });
});
