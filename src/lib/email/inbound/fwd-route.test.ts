import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GetReceivingEmailResponseSuccess } from "resend";

// ── Generic in-memory chainable/thenable Supabase-shaped query builder ──────
// Same shape as bcc-route.test.ts / process-inbound.test.ts's harness, with
// order()/limit(n) support (needed for the "most recent inbound message"
// relay-target query).
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

function makeTableClient(tables: Record<string, Row[]>, forceInsertErrors: Record<string, { code: string; message: string }> = {}) {
  return {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      return {
        select: () => makeQueryBuilder(rows, { mode: "select" }),
        insert: (payload: Row) => makeQueryBuilder(rows, { mode: "insert", payload, forceError: forceInsertErrors[table] }),
        update: (payload: Row) => makeQueryBuilder(rows, { mode: "update", payload }),
      };
    },
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────

let serviceTables: Record<string, Row[]>;
let scopedTables: Record<string, Row[]>;
let getUserByIdMock: ReturnType<typeof vi.fn>;
let forceInsertErrors: Record<string, { code: string; message: string }>;

const sendMessageMock = vi.fn();
const decryptAccountTokensMock = vi.fn((row: Row) => row);
const persistRefreshedTokenMock = vi.fn(async (...args: unknown[]) => {
  void args;
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => makeTableClient(serviceTables)),
}));

vi.mock("@/industries/_shared/features/email/lib/gmail-client", () => ({
  sendMessage: (account: unknown, args: unknown) => sendMessageMock(account, args),
}));

vi.mock("@/industries/_shared/features/email/lib/token-crypto", () => ({
  decryptAccountTokens: (row: Row) => decryptAccountTokensMock(row),
  persistRefreshedToken: (...args: unknown[]) => persistRefreshedTokenMock(...args),
}));

import { processFwdRelay, type FwdRelayParams } from "./fwd-route";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Fake ScopedClient — only from()/raw() are ever called by processFwdRelay.
function makeDb(): ScopedClient {
  const table = makeTableClient(scopedTables, forceInsertErrors);
  const rawClient = {
    ...table,
    auth: { admin: { getUserById: (id: string) => getUserByIdMock(id) } },
  };
  return {
    from: table.from,
    raw: () => rawClient,
  } as unknown as ScopedClient;
}

const BASE_RECEIVING = {
  id: "resend-fwd-1",
  subject: "Re: Application status",
  html: "<p>Sounds good, see you then</p>",
  text: "Sounds good, see you then",
  created_at: "2026-07-30T11:00:00.000Z",
  attachments: [] as unknown[],
} as unknown as GetReceivingEmailResponseSuccess;

const BASE_PARAMS: FwdRelayParams = {
  tenantId: "tenant-a",
  resendEmailId: "resend-fwd-1",
  inboundAddressId: "addr-fwd-1",
};

function seedActiveFwdToken() {
  scopedTables.inbound_addresses = [
    { id: "addr-fwd-1", tenant_id: "tenant-a", status: "active", verb: "fwd", kind: "thread", thread_id: "thread-1" },
  ];
}

function seedThreadAndAccount() {
  scopedTables.email_threads = [
    { id: "thread-1", tenant_id: "tenant-a", connected_email_account_id: "acct-1", message_count: 2, lead_id: "lead-1", contact_id: null, gmail_thread_id: null },
  ];
  scopedTables.connected_email_accounts = [
    { id: "acct-1", tenant_id: "tenant-a", user_id: "user-1", email: "rep@example.com", display_name: "Rep Person", refresh_token: "rt", access_token: "at" },
  ];
}

function seedLastInboundFromLead() {
  scopedTables.emails = [
    { id: "inbound-1", tenant_id: "tenant-a", thread_id: "thread-1", direction: "inbound", from_email: "lead@example.com", from_name: "Lead Person", received_at: "2026-07-30T10:00:00.000Z" },
  ];
}

beforeEach(() => {
  process.env.INBOUND_EMAIL_DOMAINS = "inbound.edgex.zunkireelabs.com";
  process.env.INBOUND_TOKEN_SECRET = "a".repeat(64);
  process.env.INBOUND_ENV_MARKER = "l";
  delete process.env.EDGEX_INBOUND_ENABLED;
  serviceTables = {};
  scopedTables = {};
  forceInsertErrors = {};
  getUserByIdMock = vi.fn(async () => ({ data: { user: { email: "rep@example.com" } } }));
  sendMessageMock.mockReset().mockResolvedValue({
    gmail_message_id: "gm-msg-1",
    gmail_thread_id: "gm-thread-1",
    rfc_message_id: "<relayed-1@edgex-crm.com>",
    refreshed_credentials: null,
  });
  decryptAccountTokensMock.mockReset().mockImplementation((row: Row) => row);
  persistRefreshedTokenMock.mockReset().mockResolvedValue(undefined);
});

describe("processFwdRelay — happy path (REPLYABLE-FORWARD-BRIEF Stage 2)", () => {
  it("inserts one outbound emails row (inbound_route='fwd') and relays to the lead via sendMessage() exactly once", async () => {
    seedActiveFwdToken();
    seedThreadAndAccount();
    seedLastInboundFromLead();
    const headers = { from: '"Rep Person" <rep@example.com>' };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter ?? []).toHaveLength(0);
    expect(scopedTables.emails).toHaveLength(2); // seeded inbound row + new outbound relay row
    const relayRow = scopedTables.emails.find((e) => e.direction === "outbound");
    expect(relayRow).toMatchObject({
      thread_id: "thread-1",
      direction: "outbound",
      provider: "edgex_native",
      provider_message_id: "resend-fwd-1",
      inbound_route: "fwd",
      from_email: "rep@example.com",
      sender_user_id: "user-1",
      to_emails: ["lead@example.com"],
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [account, args] = sendMessageMock.mock.calls[0];
    expect(account).toMatchObject({ id: "acct-1", email: "rep@example.com" });
    expect(args).toMatchObject({ to: ["lead@example.com"], from: "rep@example.com" });
  });
});

describe("processFwdRelay — sender guard (the security core)", () => {
  it("sender mismatch: dead-letters fwd_sender_mismatch, zero emails rows, sendMessage() NOT called", async () => {
    seedActiveFwdToken();
    seedThreadAndAccount();
    seedLastInboundFromLead();
    const headers = { from: '"Attacker" <attacker@evil.com>' };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0]).toMatchObject({ reason: "fwd_sender_mismatch" });
    expect(scopedTables.emails).toHaveLength(1); // only the pre-seeded inbound row — no relay row added
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("a connected mailbox belonging to a DIFFERENT user does not authorize the token", async () => {
    seedActiveFwdToken();
    seedThreadAndAccount();
    seedLastInboundFromLead();
    scopedTables.connected_email_accounts.push({ id: "acct-2", tenant_id: "tenant-a", user_id: "some-other-user", email: "attacker@example.com" });
    const headers = { from: '"Not The Rep" <attacker@example.com>' };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0].reason).toBe("fwd_sender_mismatch");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("revoked token: dead-letters fwd_token_revoked, no relay (independent re-check, not just resolve.ts's earlier filter)", async () => {
    scopedTables.inbound_addresses = [
      { id: "addr-fwd-1", tenant_id: "tenant-a", status: "revoked", verb: "fwd", kind: "thread", thread_id: "thread-1" },
    ];
    seedThreadAndAccount();
    seedLastInboundFromLead();
    const headers = { from: '"Rep Person" <rep@example.com>' };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0].reason).toBe("fwd_token_revoked");
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(scopedTables.emails).toHaveLength(1); // unchanged — only the pre-seeded inbound row, no relay row added
  });

  it("From = platform address: ignored — no relay, no dead-letter (loop guard §d)", async () => {
    seedActiveFwdToken();
    seedThreadAndAccount();
    seedLastInboundFromLead();
    const headers = { from: "noreply@edgex.zunkireelabs.com" };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter ?? []).toHaveLength(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(scopedTables.emails).toHaveLength(1); // unchanged — only the pre-seeded inbound row
  });
});

describe("processFwdRelay — relay send failure", () => {
  it("dead-letters fwd_relay_failed but the emails row stays present (inserted before the send)", async () => {
    seedActiveFwdToken();
    seedThreadAndAccount();
    seedLastInboundFromLead();
    sendMessageMock.mockRejectedValue(new Error("Gmail API 500"));
    const headers = { from: '"Rep Person" <rep@example.com>' };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0].reason).toBe("fwd_relay_failed");
    const relayRow = scopedTables.emails.find((e) => e.direction === "outbound");
    expect(relayRow).toBeTruthy();
    expect(relayRow?.provider_message_id).toBe("resend-fwd-1");
  });
});

describe("processFwdRelay — idempotency", () => {
  it("a redelivered webhook (23505 on provider_message_id) is a silent no-op — never a second relay send", async () => {
    seedActiveFwdToken();
    seedThreadAndAccount();
    seedLastInboundFromLead();
    forceInsertErrors.emails = { code: "23505", message: "duplicate key" };
    const headers = { from: '"Rep Person" <rep@example.com>' };

    await processFwdRelay(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(serviceTables.inbound_email_dead_letter ?? []).toHaveLength(0);
  });
});
