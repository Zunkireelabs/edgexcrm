import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// handleCompanySend — a one-off email sent from the tenant's verified company address
// (POST /api/v1/email/send with from_account_id "company"). All collaborators are mocked or
// faked in memory: no database, no network.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const resolveSenderMock = vi.fn();
const resolveNoReplyMock = vi.fn();
const scopedClientMock = vi.fn();
const shouldRestrictMock = vi.fn(() => false);
const leadVisibleMock = vi.fn(async () => true);
const loadSuppressedMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return new Set<string>();
});
const resendSendMock = vi.fn();
const emitEventMock = vi.fn(async (args: unknown) => {
  void args;
  return "evt-1";
});

vi.mock("./sender", () => ({ resolveVerifiedCompanySender: (...a: unknown[]) => resolveSenderMock(...a) }));
vi.mock("./no-reply-sender", () => ({ resolveNoReplySender: (...a: unknown[]) => resolveNoReplyMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: (...a: unknown[]) => scopedClientMock(...a) }));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: () => shouldRestrictMock() }));
vi.mock("@/lib/leads/branch-membership", () => ({ shouldLeadBeVisibleToAssignee: () => leadVisibleMock() }));
vi.mock("@/lib/api/audit", () => ({ emitEvent: (a: unknown) => emitEventMock(a) }));
vi.mock("./index", () => ({
  getResendClient: () => ({ emails: { send: (p: unknown) => resendSendMock(p) } }),
}));
vi.mock("./outbound/rate-limit", () => ({ acquireResendRateLimitSlot: async () => {} }));
vi.mock("./outbound/suppression", () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  loadSuppressedEmails: (...a: unknown[]) => loadSuppressedMock(...a),
}));

const AUTH = {
  userId: "user-1",
  email: "manish@admizz.com",
  tenantId: "tenant-a",
  role: "counselor",
  industryId: "education_consultancy",
  permissions: {},
} as unknown as AuthContext;

const SENDER = {
  from: "Admizz Education <hello@mail.admizz.com>",
  address: "hello@mail.admizz.com",
  name: "Admizz Education",
  replyTo: "hello@admizz.com",
};

const NO_REPLY = {
  sender: {
    from: "Admizz Education <no-reply@mail.admizz.com>",
    address: "no-reply@mail.admizz.com",
    name: "Admizz Education",
    replyTo: "hello@admizz.com",
  },
  brand: {
    name: "Admizz Education",
    logoUrl: "https://cdn.example.com/admizz-logo.png",
    color: "#0D1282",
    accent: "#FDED22",
    helpEmail: "hello@admizz.com",
  },
};

interface FakeDbCfg {
  tenantInboundEnabled?: boolean;
  lead?: Row | null;
  contact?: Row | null;
  replyThread?: Row | null;
  /** Does the reply thread already hold an outbound message sent via Resend? */
  priorCompanyEmail?: boolean;
  failAddressInsert?: boolean;
}

/** A chainable in-memory stand-in for the scoped Supabase client that records every call in order. */
function fakeDb(cfg: FakeDbCfg = {}) {
  const log: { table: string; op: string; payload?: Row; filters: [string, unknown][] }[] = [];
  let seq = 0;

  const db = {
    raw: () => ({}),
    from(table: string) {
      const st = { table, op: "select", payload: undefined as Row | undefined, filters: [] as [string, unknown][] };
      const done = (single: boolean) => {
        log.push({ table, op: st.op, payload: st.payload, filters: st.filters });
        const key = `${table}.${st.op}`;
        switch (key) {
          case "tenant_email_settings.select":
            return { data: { inbound_enabled: cfg.tenantInboundEnabled ?? false }, error: null };
          case "leads.select":
            return { data: cfg.lead === undefined ? { first_name: "Art", last_name: "Dutta" } : cfg.lead, error: null };
          case "contacts.select":
            return { data: cfg.contact ?? null, error: null };
          case "email_threads.select":
            return { data: cfg.replyThread ?? null, error: null };
          case "emails.select":
            return { data: cfg.priorCompanyEmail ? { id: "prior-email" } : null, error: null };
          case "inbound_addresses.insert":
            return cfg.failAddressInsert
              ? { data: null, error: { message: "boom" } }
              : { data: { id: `addr-${++seq}` }, error: null };
          case "email_threads.insert":
            return { data: { id: `thread-${++seq}` }, error: null };
          case "emails.insert":
            return { data: { id: `email-${++seq}` }, error: null };
          default:
            void single;
            return { data: null, error: null };
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        insert: (p: Row) => ((st.op = "insert"), (st.payload = p), b),
        update: (p: Row) => ((st.op = "update"), (st.payload = p), b),
        delete: () => ((st.op = "delete"), b),
        eq: (c: string, v: unknown) => (st.filters.push([c, v]), b),
        is: (c: string, v: unknown) => (st.filters.push([c, v]), b),
        limit: () => b,
        single: async () => done(true),
        maybeSingle: async () => done(false),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(done(false)).then(res, rej),
      };
      return b;
    },
  };
  return { db, log };
}

const ENV_KEYS = [
  "EMAIL_TRANSPORT",
  "EMAIL_OUTBOUND_SANDBOX",
  "EMAIL_TEST_RECIPIENTS",
  "EDGEX_INBOUND_ENABLED",
  "INBOUND_TOKEN_SECRET",
  "INBOUND_EMAIL_DOMAINS",
  "INBOUND_ENV_MARKER",
] as const;
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
  process.env.EMAIL_TRANSPORT = "resend";
  process.env.EMAIL_OUTBOUND_SANDBOX = "false";
  delete process.env.EMAIL_TEST_RECIPIENTS;
  delete process.env.EDGEX_INBOUND_ENABLED;
  process.env.INBOUND_TOKEN_SECRET = "test-secret";
  process.env.INBOUND_EMAIL_DOMAINS = "edgex.zunkireelabs.com";
  process.env.INBOUND_ENV_MARKER = "s";

  resolveSenderMock.mockReset().mockResolvedValue(SENDER);
  resolveNoReplyMock.mockReset().mockResolvedValue(NO_REPLY);
  scopedClientMock.mockReset();
  shouldRestrictMock.mockReset().mockReturnValue(false);
  leadVisibleMock.mockReset().mockResolvedValue(true);
  loadSuppressedMock.mockReset().mockResolvedValue(new Set());
  resendSendMock.mockReset().mockResolvedValue({ data: { id: "resend-msg-1" }, error: null });
  emitEventMock.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

async function run(body: Row, cfg: FakeDbCfg = {}) {
  const { db, log } = fakeDb(cfg);
  scopedClientMock.mockResolvedValue(db);
  const { handleCompanySend } = await import("./company-send");
  const res = await handleCompanySend(AUTH, {
    from_account_id: "company",
    to: ["art@gmail.com"],
    subject: "Hello {{first_name}}",
    body_html: "<p>Hi {{first_name}} {{last_name}}</p>",
    lead_id: "lead-1",
    ...body,
  });
  return { res, json: await res.json(), log };
}

describe("handleCompanySend — availability", () => {
  it("refuses with 400 when the tenant has no verified company sender, and sends nothing", async () => {
    resolveSenderMock.mockResolvedValue(null);
    const { res, json } = await run({});
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("COMPANY_SENDER_UNAVAILABLE");
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("handleCompanySend — inbound OFF (today's prod): behaves like the company sender always did", () => {
  it("sends from the company address with the tenant Reply-To, then records the thread + email AFTER the send", async () => {
    const { res, json, log } = await run({});
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ gmail_message_id: null });

    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.from).toBe("Admizz Education <hello@mail.admizz.com>");
    expect(sent.to).toEqual(["art@gmail.com"]);
    expect(sent.replyTo).toBe("hello@admizz.com");
    expect(sent.subject).toBe("Hello Art"); // merge field filled
    expect(sent.html).toBe("<p>Hi Art Dutta</p>");
    expect(sent.headers).toBeUndefined(); // 1:1 mail: no bulk/unsubscribe headers

    // nothing inbound was minted
    expect(log.some((c) => c.table === "inbound_addresses")).toBe(false);

    const thread = log.find((c) => c.table === "email_threads" && c.op === "insert")!;
    expect(thread.payload).toMatchObject({
      provider: "edgex_native",
      connected_email_account_id: null,
      lead_id: "lead-1",
      message_count: 1,
    });
    const email = log.find((c) => c.table === "emails" && c.op === "insert")!;
    expect(email.payload).toMatchObject({
      provider: "resend",
      provider_message_id: "resend-msg-1",
      direction: "outbound",
      from_email: "hello@mail.admizz.com",
      from_name: "Admizz Education",
      sender_user_id: "user-1",
      connected_email_account_id: null,
      gmail_message_id: null,
    });
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "email.sent" }));
  });

  it("every column that is STILL NOT NULL in the database (migrations 025 + 191) is non-null in the emails row", async () => {
    // emails.rfc_message_id is NOT NULL and was never relaxed — a null here would make the insert fail AFTER the
    // email was delivered (the user sees an error, retries, and the lead gets it twice). A fake db can't enforce
    // constraints, so this pins them: direction, from_email, thread_id, rfc_message_id, to/cc/bcc/rfc_references.
    const { log } = await run({});
    const row = log.find((c) => c.table === "emails" && c.op === "insert")!.payload!;
    for (const col of ["thread_id", "direction", "from_email", "rfc_message_id", "to_emails", "cc_emails", "bcc_emails", "rfc_references", "provider"]) {
      expect(row[col], `emails.${col} must not be null`).not.toBeNull();
      expect(row[col], `emails.${col} must be set`).not.toBeUndefined();
    }
    expect(row.rfc_message_id).toBe("<resend-msg-1@resend.edgex.invalid>");
  });

  it("stub transport (stage) never calls Resend but still records the email", async () => {
    process.env.EMAIL_TRANSPORT = "stub";
    const { res, log } = await run({});
    expect(res.status).toBe(200);
    expect(resendSendMock).not.toHaveBeenCalled();
    const email = log.find((c) => c.table === "emails" && c.op === "insert")!;
    expect(String(email.payload!.provider_message_id)).toMatch(/^stub_/);
  });
});

describe("handleCompanySend — inbound ON: replies come back into EdgeX", () => {
  beforeEach(() => {
    process.env.EDGEX_INBOUND_ENABLED = "true";
  });

  it("creates the thread + a reply token BEFORE sending and uses the EdgeX address as Reply-To", async () => {
    const { res, log } = await run({}, { tenantInboundEnabled: true });
    expect(res.status).toBe(200);

    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.replyTo).toMatch(/^"Admizz Education" <reply\+s[0-9a-f]{42}@edgex\.zunkireelabs\.com>$/);
    expect(sent.replyTo).not.toContain("hello@admizz.com");

    const threadInsert = log.findIndex((c) => c.table === "email_threads" && c.op === "insert");
    const addrInsert = log.findIndex((c) => c.table === "inbound_addresses" && c.op === "insert");
    const threadFinalize = log.findIndex((c) => c.table === "email_threads" && c.op === "update");
    expect(threadInsert).toBeGreaterThanOrEqual(0);
    expect(addrInsert).toBeGreaterThan(threadInsert);
    expect(threadFinalize).toBeGreaterThan(addrInsert); // finalised after the send

    expect(log[addrInsert].payload).toMatchObject({ kind: "thread", verb: "reply", thread_id: "thread-1" });
    // the token in the address is the one that was stored
    expect(sent.replyTo).toContain(String(log[addrInsert].payload!.token));
    expect(log[threadInsert].payload).toMatchObject({ message_count: 0, provider: "edgex_native" });
  });

  it("falls back to the tenant Reply-To (and still sends) when the tenant has inbound switched off", async () => {
    const { res, log } = await run({}, { tenantInboundEnabled: false });
    expect(res.status).toBe(200);
    expect(resendSendMock.mock.calls[0][0].replyTo).toBe("hello@admizz.com");
    expect(log.some((c) => c.table === "inbound_addresses")).toBe(false);
  });

  it("when minting fails it cleans up, still sends, and uses the tenant Reply-To", async () => {
    const { res, log } = await run({}, { tenantInboundEnabled: true, failAddressInsert: true });
    expect(res.status).toBe(200);
    expect(resendSendMock.mock.calls[0][0].replyTo).toBe("hello@admizz.com");
    // the provisional thread made before the failed token insert was deleted
    expect(log.some((c) => c.table === "email_threads" && c.op === "delete")).toBe(true);
    // and the email is still recorded on a (fresh) thread
    expect(log.some((c) => c.table === "emails" && c.op === "insert")).toBe(true);
  });

  it("when the provider rejects the send, the provisional thread + token are removed and nothing is recorded", async () => {
    resendSendMock.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad" } });
    const { res, log } = await run({}, { tenantInboundEnabled: true });
    expect(res.status).toBe(503);
    expect(log.some((c) => c.table === "inbound_addresses" && c.op === "delete")).toBe(true);
    expect(log.some((c) => c.table === "email_threads" && c.op === "delete")).toBe(true);
    expect(log.some((c) => c.table === "emails" && c.op === "insert")).toBe(false);
    expect(emitEventMock).not.toHaveBeenCalled();
  });
});

describe("handleCompanySend — safety nets", () => {
  it("never emails a suppressed (unsubscribed / bounced) address", async () => {
    loadSuppressedMock.mockResolvedValue(new Set(["art@gmail.com"]));
    const { res, json } = await run({});
    expect(res.status).toBe(422);
    expect(json.error.code).toBe("RECIPIENT_SUPPRESSED");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("fails closed when the suppression check itself errors", async () => {
    loadSuppressedMock.mockRejectedValue(new Error("db down"));
    const { res } = await run({});
    expect(res.status).toBe(503);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("sandbox: redirects to the test recipients, drops cc/bcc, prefixes the subject — but records the real recipient and original subject", async () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "true";
    process.env.EMAIL_TEST_RECIPIENTS = "qa@zunkireelabs.com";
    const { res, log } = await run({ cc: ["boss@admizz.com"], bcc: ["audit@admizz.com"] });
    expect(res.status).toBe(200);

    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.to).toEqual(["qa@zunkireelabs.com"]);
    expect(sent.cc).toBeUndefined();
    expect(sent.bcc).toBeUndefined();
    expect(sent.subject).toMatch(/^\[SANDBOX intended: art@gmail\.com\] /);

    const email = log.find((c) => c.table === "emails" && c.op === "insert")!;
    expect(email.payload!.to_emails).toEqual(["art@gmail.com"]);
    expect(email.payload!.subject).toBe("Hello Art");
  });

  it("sandbox with no test recipients configured refuses rather than mailing a real person", async () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "true";
    delete process.env.EMAIL_TEST_RECIPIENTS;
    const { res } = await run({});
    expect(res.status).toBe(503);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid address and more than 10 recipients", async () => {
    const bad = await run({ to: ["not-an-email"] });
    expect(bad.res.status).toBe(422);
    const many = await run({ to: Array.from({ length: 11 }, (_, i) => `p${i}@x.com`) });
    expect(many.res.status).toBe(422);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it('accepts "Name <addr>" pasted from a mail client', async () => {
    const { res } = await run({ to: ["Art Dutta <art@gmail.com>"] });
    expect(res.status).toBe(200);
    expect(resendSendMock.mock.calls[0][0].to).toEqual(["art@gmail.com"]);
  });
});

describe("handleCompanySend — who may send to which lead", () => {
  it("403s an own-scope user on a lead they cannot see, and sends nothing", async () => {
    shouldRestrictMock.mockReturnValue(true);
    leadVisibleMock.mockResolvedValue(false);
    const { res } = await run({});
    expect(res.status).toBe(403);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("404s a lead that does not exist in this tenant", async () => {
    const { res } = await run({}, { lead: null });
    expect(res.status).toBe(404);
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("handleCompanySend — replying on a thread", () => {
  const REPLY = { thread_id: "t-1", in_reply_to: "<abc@lead.mail>", references: ["<x@y>"] };

  it("refuses a thread that belongs to someone's connected Gmail", async () => {
    const { res, json } = await run(
      { reply_context: REPLY },
      { replyThread: { id: "t-1", message_count: 2, lead_id: "lead-1", contact_id: null, connected_email_account_id: "acct-9" } },
    );
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("REPLY_ACCOUNT_MISMATCH");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("refuses a no-account thread that the company address never wrote on (e.g. a personal BCC thread)", async () => {
    const { res, json } = await run(
      { reply_context: REPLY },
      { replyThread: { id: "t-1", message_count: 2, lead_id: "lead-1", contact_id: null, connected_email_account_id: null }, priorCompanyEmail: false },
    );
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("REPLY_ACCOUNT_MISMATCH");
  });

  it("replies on a company-started thread: same thread, counter bumped, threading headers sent", async () => {
    const { res, json, log } = await run(
      { reply_context: REPLY, subject: "Re: Hello", lead_id: undefined },
      { replyThread: { id: "t-1", message_count: 2, lead_id: "lead-1", contact_id: null, connected_email_account_id: null }, priorCompanyEmail: true },
    );
    expect(res.status).toBe(200);
    expect(json.data.thread_id).toBe("t-1");

    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.headers).toEqual({ "In-Reply-To": "<abc@lead.mail>", References: "<x@y>" });

    expect(log.some((c) => c.table === "email_threads" && c.op === "insert")).toBe(false);
    const upd = log.find((c) => c.table === "email_threads" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ message_count: 3 });
    expect(upd.filters).toContainEqual(["id", "t-1"]);
  });

  it("never puts our own synthetic Message-ID on the wire when replying to a previous company-sender message", async () => {
    const synthetic = "<resend-prev@resend.edgex.invalid>";
    const { res } = await run(
      { reply_context: { thread_id: "t-1", in_reply_to: synthetic, references: ["<real@lead.mail>", synthetic] }, subject: "Re: Hello", lead_id: undefined },
      { replyThread: { id: "t-1", message_count: 1, lead_id: "lead-1", contact_id: null, connected_email_account_id: null }, priorCompanyEmail: true },
    );
    expect(res.status).toBe(200);
    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.headers).toEqual({ References: "<real@lead.mail>" }); // no In-Reply-To, synthetic reference dropped
  });
});

describe("handleCompanySend — the no-reply sender (branded layout)", () => {
  const noReply = (body: Row = {}, cfg: FakeDbCfg = {}) => run({ from_account_id: "no-reply", ...body }, cfg);

  it("refuses with 400 when the tenant has no no-reply address set up, and sends nothing", async () => {
    resolveNoReplyMock.mockResolvedValue(null);
    const { res, json } = await noReply();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("NO_REPLY_SENDER_UNAVAILABLE");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("sends from the no-reply address, with the tenant Reply-To (the team mailbox)", async () => {
    const { res } = await noReply();
    expect(res.status).toBe(200);
    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.from).toBe("Admizz Education <no-reply@mail.admizz.com>");
    expect(sent.replyTo).toBe("hello@admizz.com");
    expect(sent.to).toEqual(["art@gmail.com"]);
    expect(sent.subject).toBe("Hello Art"); // merge field filled
  });

  it("wraps the typed message in the branded layout: logo first, the message (name filled in), then the footer", async () => {
    await noReply();
    const html: string = resendSendMock.mock.calls[0][0].html;
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    const logo = html.indexOf("https://cdn.example.com/admizz-logo.png");
    const msg = html.indexOf("<p>Hi Art Dutta</p>");
    const footer = html.indexOf("Need help? Write to");
    expect(logo).toBeGreaterThan(-1);
    expect(msg).toBeGreaterThan(logo);
    expect(footer).toBeGreaterThan(msg);
    expect(html).toContain("#0D1282");
    expect(html).toContain('href="mailto:hello@admizz.com"');
    expect(html).not.toContain("{{first_name}}"); // merge fields are filled BEFORE the wrap
  });

  it("records what was TYPED (not the wrapped email) on the thread, from the no-reply address, after the send", async () => {
    const { log } = await noReply();
    const email = log.find((c) => c.table === "emails" && c.op === "insert")!;
    expect(email.payload).toMatchObject({
      provider: "resend",
      from_email: "no-reply@mail.admizz.com",
      from_name: "Admizz Education",
      body_html: "<p>Hi Art Dutta</p>",
      connected_email_account_id: null,
    });
    expect(String(email.payload!.body_html)).not.toContain("<!DOCTYPE");
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "email.sent", payload: expect.objectContaining({ from_account_id: "no-reply" }) }),
    );
  });

  it("cannot be used to REPLY to a message: refused before anything is read or sent", async () => {
    const { res, json } = await noReply({ reply_context: { thread_id: "thread-9" } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(json)).toContain("can't be used to reply");
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("the plain company sender is unchanged: no layout, and the no-reply resolver is never consulted", async () => {
    const { res } = await run({});
    expect(res.status).toBe(200);
    expect(resendSendMock.mock.calls[0][0].html).toBe("<p>Hi Art Dutta</p>");
    expect(resendSendMock.mock.calls[0][0].from).toBe("Admizz Education <hello@mail.admizz.com>");
    expect(resolveNoReplyMock).not.toHaveBeenCalled();
  });

  it("keeps every safety net: a suppressed address is never emailed", async () => {
    loadSuppressedMock.mockResolvedValue(new Set(["art@gmail.com"]));
    const { res, json } = await noReply();
    expect(res.status).toBe(422);
    expect(json.error.code).toBe("RECIPIENT_SUPPRESSED");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("keeps the lead rules: an own-scope user cannot send to a lead they cannot see", async () => {
    shouldRestrictMock.mockReturnValue(true);
    leadVisibleMock.mockResolvedValue(false);
    const { res } = await noReply();
    expect(res.status).toBe(403);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("sandbox: the wrapped email goes to the test recipients with the prefixed subject, like any other email", async () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "true";
    process.env.EMAIL_TEST_RECIPIENTS = "qa@zunkireelabs.com";
    const { res } = await noReply();
    expect(res.status).toBe(200);
    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.to).toEqual(["qa@zunkireelabs.com"]);
    expect(sent.html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("when the provider rejects the send, nothing is recorded", async () => {
    resendSendMock.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad" } });
    const { res, log } = await noReply();
    expect(res.status).toBe(503);
    expect(log.some((c) => c.table === "emails" && c.op === "insert")).toBe(false);
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("inbound ON: the layout is still applied and Reply-To points back at EdgeX, exactly like the company sender", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "true";
    const { res } = await noReply({}, { tenantInboundEnabled: true });
    expect(res.status).toBe(200);
    const sent = resendSendMock.mock.calls[0][0];
    expect(sent.replyTo).toMatch(/^"Admizz Education" <reply\+s[0-9a-f]{42}@edgex\.zunkireelabs\.com>$/);
    expect(sent.html.startsWith("<!DOCTYPE html>")).toBe(true);
  });
});
