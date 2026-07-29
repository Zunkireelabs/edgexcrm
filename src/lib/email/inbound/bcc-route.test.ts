import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GetReceivingEmailResponseSuccess } from "resend";

// ── Generic in-memory chainable/thenable Supabase-shaped query builder ──────
// Same shape as process-inbound.test.ts's harness — bcc-route.ts is called
// with a plain ScopedClient-shaped object here (no scopedClientForTenant
// involved), since processBccDropbox() takes `db` as a parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function makeQueryBuilder(
  rows: Row[],
  opts: { mode: "select" | "insert" | "update"; payload?: Row; forceError?: { code: string; message: string } },
) {
  const filters: Array<[string, unknown]> = [];

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
    return { data: rows.filter(matches), error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) {
      filters.push([col, val]);
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

interface LeadIdentityResult {
  match: "none" | "email" | "phone";
  existingLead: { id: string } | null;
  phoneMatchLeadIds: string[];
}

const resolveLeadIdentityMock = vi.fn(
  async (supabase: unknown, params: unknown): Promise<LeadIdentityResult> => {
    void supabase;
    void params;
    return { match: "none", existingLead: null, phoneMatchLeadIds: [] };
  },
);

import type { EmailThreadRow } from "./match-thread";

const matchInboundToThreadMock = vi.fn(
  async (supabase: unknown, params: unknown): Promise<EmailThreadRow | null> => {
    void supabase;
    void params;
    return null;
  },
);

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => makeTableClient(serviceTables)),
}));

vi.mock("./match-thread", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./match-thread")>();
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

import { processBccDropbox, type BccDropboxParams } from "./bcc-route";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Fake ScopedClient — only from()/raw() are ever called by processBccDropbox;
// fromGlobal/rpc are unused here, so the cast below is deliberate rather than
// fully implementing the real (much larger) interface.
function makeDb(forceInsertErrors: Record<string, { code: string; message: string }> = {}): ScopedClient {
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
  id: "resend-1",
  subject: "Re: Application status",
  html: "<p>Hi there</p>",
  text: "Hi there",
  created_at: "2026-07-28T10:00:00.000Z",
  attachments: [] as unknown[],
} as unknown as GetReceivingEmailResponseSuccess;

const BASE_PARAMS: BccDropboxParams = {
  tenantId: "tenant-a",
  resendEmailId: "resend-1",
  userId: "user-1",
};

beforeEach(() => {
  process.env.INBOUND_EMAIL_DOMAINS = "inbound.edgex.zunkireelabs.com";
  serviceTables = {};
  scopedTables = {};
  getUserByIdMock = vi.fn(async (id: string) => {
    void id;
    return { data: { user: { email: "rep@example.com" } } };
  });
  resolveLeadIdentityMock.mockReset().mockResolvedValue({ match: "none", existingLead: null, phoneMatchLeadIds: [] });
  matchInboundToThreadMock.mockReset().mockResolvedValue(null);
});

describe("processBccDropbox — sender-authenticity guard (brief §5 step 2)", () => {
  it("dead-letters bcc_sender_mismatch when From != token owner's email, and writes no emails row", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { email: "rep@example.com" } } });
    const headers = { from: '"Someone Else" <someone-else@example.com>', to: "lead@example.com" };

    await processBccDropbox(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0]).toMatchObject({
      tenant_id: "tenant-a",
      reason: "bcc_sender_mismatch",
    });
    expect(scopedTables.emails ?? []).toHaveLength(0);
    expect(resolveLeadIdentityMock).not.toHaveBeenCalled();
  });

  it("dead-letters bcc_sender_mismatch when the token owner has no resolvable email", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: null } });
    const headers = { from: '"Rep" <rep@example.com>', to: "lead@example.com" };

    await processBccDropbox(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0].reason).toBe("bcc_sender_mismatch");
    expect(scopedTables.emails ?? []).toHaveLength(0);
  });
});

describe("processBccDropbox — own-domain filter (brief §5 step 3)", () => {
  it("never lead-matches a dropbox address that appears in To/Cc", async () => {
    const headers = {
      from: '"Rep" <rep@example.com>',
      to: "bcc+s0abcdef123456checksum@inbound.edgex.zunkireelabs.com",
    };

    await processBccDropbox(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(resolveLeadIdentityMock).not.toHaveBeenCalled();
    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0].reason).toBe("bcc_no_lead_match");
  });
});

describe("processBccDropbox — no lead match (brief §5 step 4)", () => {
  it("dead-letters bcc_no_lead_match and creates no thread when no recipient matches a lead", async () => {
    resolveLeadIdentityMock.mockResolvedValue({ match: "none", existingLead: null, phoneMatchLeadIds: [] });
    const headers = { from: '"Rep" <rep@example.com>', to: "unknown-person@example.com" };

    await processBccDropbox(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter).toHaveLength(1);
    expect(serviceTables.inbound_email_dead_letter[0].reason).toBe("bcc_no_lead_match");
    expect(scopedTables.email_threads ?? []).toHaveLength(0);
    expect(scopedTables.emails ?? []).toHaveLength(0);
  });
});

describe("processBccDropbox — happy path (brief §5 steps 6-7)", () => {
  it("inserts one outbound row attributed to the token owner, on a new edgex_native thread", async () => {
    resolveLeadIdentityMock.mockResolvedValue({ match: "email", existingLead: { id: "lead-1" }, phoneMatchLeadIds: [] });
    const headers = {
      from: '"Rep Person" <rep@example.com>',
      to: "lead@example.com",
      "message-id": "<msg-1@mail.gmail.com>",
      date: "Tue, 28 Jul 2026 09:00:00 +0000",
    };

    await processBccDropbox(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter ?? []).toHaveLength(0);
    expect(scopedTables.email_threads).toHaveLength(1);
    expect(scopedTables.email_threads[0]).toMatchObject({
      provider: "edgex_native",
      connected_email_account_id: null,
      gmail_thread_id: null,
      lead_id: "lead-1",
    });

    expect(scopedTables.emails).toHaveLength(1);
    expect(scopedTables.emails[0]).toMatchObject({
      thread_id: scopedTables.email_threads[0].id,
      direction: "outbound",
      provider: "edgex_native",
      provider_message_id: "resend-1",
      inbound_route: "bcc",
      sender_user_id: "user-1",
      from_email: "rep@example.com",
      from_name: "Rep Person",
      to_emails: ["lead@example.com"],
      rfc_message_id: "<msg-1@mail.gmail.com>",
      received_at: null,
      sent_at: "Tue, 28 Jul 2026 09:00:00 +0000",
    });
  });
});

describe("processBccDropbox — EdgeX-sent copy dedup (brief §5 step 5)", () => {
  it("skips silently (no dead-letter, no second row) when rfc_message_id already exists in this tenant", async () => {
    resolveLeadIdentityMock.mockResolvedValue({ match: "email", existingLead: { id: "lead-1" }, phoneMatchLeadIds: [] });
    scopedTables.emails = [
      { id: "existing-1", tenant_id: "tenant-a", rfc_message_id: "<msg-1@mail.gmail.com>" },
    ];
    const headers = {
      from: '"Rep Person" <rep@example.com>',
      to: "lead@example.com",
      "message-id": "<msg-1@mail.gmail.com>",
    };

    await processBccDropbox(BASE_PARAMS, makeDb(), BASE_RECEIVING, headers);

    expect(serviceTables.inbound_email_dead_letter ?? []).toHaveLength(0);
    expect(scopedTables.emails).toHaveLength(1); // unchanged — no second row
    expect(scopedTables.email_threads ?? []).toHaveLength(0); // never reached thread step
  });
});
