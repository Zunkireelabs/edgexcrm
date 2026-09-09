import { describe, it, expect, vi, beforeEach } from "vitest";

// OUTREACH-PHASE1-BRIEF.md §8 items 4/5, mirroring SMS-PHASE3A-FIXES-BRIEF.md
// F-1: finalizeEmailBlast() must never transition a user-cancelled blast out
// of 'cancelled', and must count 'cancelled' rows separately from 'failed'
// (recipients_failed means "we tried and it failed", not "we never got to it").

const scopedClientForTenantMock = vi.fn();
const buildUserAuthContextMock = vi.fn();
const resolveAudienceMock = vi.fn();
const sendQueuedEmailBatchMock = vi.fn();
const inngestSendMock = vi.fn();

// Captures the real emailBlastSend handler (createFunction's second arg)
// instead of discarding it, so the draft/queued-race regression tests below
// can invoke the actual orchestration logic end-to-end via a fake `step`.
let capturedHandler: ((args: { event: { data: unknown }; step: FakeStep }) => Promise<unknown>) | null = null;

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: buildUserAuthContextMock }));
vi.mock("@/lib/email/outbound/audience", () => ({ resolveAudience: resolveAudienceMock }));
vi.mock("@/lib/email/outbound/send", () => ({ sendQueuedEmailBatch: sendQueuedEmailBatchMock }));
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, handler: typeof capturedHandler) => {
      capturedHandler = handler;
      return {};
    }),
    send: inngestSendMock,
  },
}));

interface FakeStep {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  sleep: (name: string, duration: string) => Promise<void>;
  sleepUntil: (name: string, date: Date) => Promise<void>;
}

function fakeStep(): FakeStep {
  return {
    run: async (_name, fn) => fn(),
    sleep: async () => {},
    sleepUntil: async () => {},
  };
}

interface FakeMessageRow {
  status: string;
}

function fakeDb(initialBlastStatus: string, messageRows: FakeMessageRow[]) {
  const messages = messageRows.map((r) => ({ ...r }));
  const blastUpdateCalls: Record<string, unknown>[] = [];
  const orderCalls: { col: string; opts: unknown }[] = [];

  return {
    db: {
      from(table: string) {
        if (table === "email_blasts") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: initialBlastStatus }, error: null }) }),
            }),
            update: (patch: Record<string, unknown>) => {
              blastUpdateCalls.push(patch);
              return { eq: () => Promise.resolve({ data: null, error: null }) };
            },
          };
        }
        if (table === "email_messages") {
          const rangeNode = {
            range: (from: number, to: number) => {
              const statuses = messages.map((m) => ({ status: m.status }));
              return Promise.resolve({ data: statuses.slice(from, to + 1), error: null });
            },
          };
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  // offset pagination needs a deterministic total order —
                  // paginate.ts's ORDERING CONTRACT. Record the call so the
                  // test can assert .order fires before .range.
                  order: (col: string, opts: unknown) => {
                    orderCalls.push({ col, opts });
                    return rangeNode;
                  },
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
    blastUpdateCalls,
    orderCalls,
  };
}

describe("computeBlastCounts — throttle-branch counter staleness regression", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("recomputes sent/failed/suppressed live from email_messages, not from a caller's accumulated total — this is what the throttle branch stamps so recipients_sent never lags the per-row table while a blast sits in 'throttled' (OUTREACH-PHASE1-BRIEF.md §6)", async () => {
    const fake = fakeDb("throttled", [
      { status: "sent" },
      { status: "sent" },
      { status: "delivered" },
      { status: "queued" },
      { status: "queued" },
      { status: "suppressed" },
      { status: "failed" },
    ]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    const counts = await computeBlastCounts("tenant-1", "blast-throttled");

    // 'queued' rows (not yet attempted this cycle) must NOT count as sent —
    // the bug this regression guards against is the opposite: reporting 0
    // sent while rows have actually already landed as 'sent'/'delivered'.
    expect(counts.sent).toBe(3);
    expect(counts.failed).toBe(1);
    expect(counts.suppressed).toBe(1);
    expect(counts.cancelled).toBe(0);
  });

  it("counts every row across a real Admizz-scale (3000+) blast, not just the first 1000 (PostgREST page-cap trap)", async () => {
    // The 3,118-row email blast that motivated this branch is already past
    // PostgREST's 1000-row unpaged-select cap — an unpaginated query here
    // would show a wrong live count on the "Throttled" banner mid-send and a
    // wrong final tally once the blast completes.
    const rows: FakeMessageRow[] = [
      ...Array.from({ length: 2000 }, () => ({ status: "sent" })),
      ...Array.from({ length: 1118 }, () => ({ status: "queued" })),
    ];
    const fake = fakeDb("throttled", rows);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    const counts = await computeBlastCounts("tenant-1", "blast-large");

    expect(counts.sent).toBe(2000);
  });

  it("orders the paged query by a deterministic key before ranging (offset paging over an unordered result skips/dupes boundary rows)", async () => {
    const fake = fakeDb("throttled", [{ status: "sent" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    await computeBlastCounts("tenant-1", "blast-1");

    expect(fake.orderCalls.length).toBeGreaterThan(0);
    expect(fake.orderCalls[0]).toEqual({ col: "id", opts: { ascending: true } });
  });

  // F5 (docs/BLAST-FINDINGS-2026-09-06.md) — total is what lets a caller
  // (finalizeEmailBlast) tell "everyone's accounted for" apart from "some
  // rows are still 'queued'/'sending' and nobody's noticed."
  it("total reflects every row regardless of status, including ones no bucket counts ('queued', 'sending')", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "queued" }, { status: "sending" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    const counts = await computeBlastCounts("tenant-1", "blast-1");

    expect(counts.total).toBe(3);
    expect(counts.sent + counts.failed + counts.cancelled + counts.suppressed).toBe(1); // only the 'sent' row
  });
});

describe("finalizeEmailBlast — F-1 regression (cancel never overwritten)", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("a blast already cancelled (by /cancel) stays cancelled — never overwritten to failed/partially_failed", async () => {
    const fake = fakeDb("cancelled", [{ status: "sent" }, { status: "cancelled" }, { status: "cancelled" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-1");

    expect(result.finalStatus).toBe("cancelled");
    // recipients_failed must mean "we tried and it failed" — the 2 cancelled
    // rows must NOT inflate it.
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(2);
    expect(result.sent).toBe(1);

    const finalUpdate = fake.blastUpdateCalls[fake.blastUpdateCalls.length - 1];
    expect(finalUpdate.status).toBe("cancelled");
    expect(finalUpdate.recipients_failed).toBe(0);
  });

  it("natural completion with no failures finalizes sent", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-3");

    expect(result.finalStatus).toBe("sent");
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(0);
  });

  it("mixed sent/failed with no cancellation finalizes partially_failed, and bounced counts as failed", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "failed" }, { status: "bounced" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-4");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(2);
  });

  it("all failed with nothing sent finalizes failed", async () => {
    const fake = fakeDb("sending", [{ status: "failed" }, { status: "failed" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-5");

    expect(result.finalStatus).toBe("failed");
    expect(result.sent).toBe(0);
  });
});

// F5 (docs/BLAST-FINDINGS-2026-09-06.md) — the real incident: a blast
// finalized 'sent' with 12,100 of 16,000 rows still 'queued'. Regression
// coverage for the safety net: finalize must never report a clean 'sent' (or
// silently drop the shortfall into any other bucket) while rows are still
// unaccounted for.
describe("finalizeEmailBlast — F5 regression (never a false 'sent' while rows are unaccounted for)", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("rows still 'queued' at finalize time -> partially_failed, never a false 'sent'", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }, { status: "queued" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-unaccounted-1");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(2); // the two real successes are still reported accurately
  });

  it("a row stranded 'sending' at finalize time -> partially_failed, never a false 'sent' (the exact F5 mechanism)", async () => {
    const fake = fakeDb("sending", Array.from({ length: 9 }, () => ({ status: "sent" })).concat([{ status: "sending" }]));
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-unaccounted-2");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(9);
  });

  it("everyone accounted for (no queued/sending leftover) still finalizes sent normally — the safety net never fires on a genuinely clean run", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }, { status: "suppressed" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-clean");

    expect(result.finalStatus).toBe("sent");
  });

  it("a cancelled blast with leftover cancelled-but-uncounted rows still finalizes cancelled — the F-1 guarantee takes priority over the unaccounted-for check", async () => {
    // /cancel only flips 'queued' rows to 'cancelled', never a 'sending' one
    // — so a cancel racing a crash can leave a 'sending' row behind even on
    // an intentionally-cancelled blast. That must still resolve to
    // 'cancelled', not 'partially_failed'.
    const fake = fakeDb("cancelled", [{ status: "sent" }, { status: "cancelled" }, { status: "sending" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-cancelled-with-leftover");

    expect(result.finalStatus).toBe("cancelled");
  });
});

// materializeBlastAudience is what used to be send/route.ts's synchronous
// audience-resolution + cap-check + row-materialization logic, moved here so
// it runs entirely in the background (see this file's header comment and the
// route's own comment for why). This coverage is migrated near-verbatim from
// the old send/route.test.ts, which tested the identical behavior at the
// route layer before this move.
function audienceRow(leadId: string, email: string) {
  return { leadId, email, lead: { id: leadId, email, first_name: "Test" } };
}

const FULL_AUTH = {
  userId: "user-1",
  tenantId: "tenant-1",
  industryId: "education_consultancy",
  positionSlug: null,
  branchId: null,
  permissions: { leadScope: "all", pipelineAccess: "all" },
};

function fakeMaterializeDb(opts: { failUpsertOnce?: boolean; failUpsertAlways?: boolean; maxRecipientsPerBlast?: number } = {}) {
  const messages = new Map<string, Record<string, unknown>>();
  let upsertFailuresLeft = opts.failUpsertOnce ? 1 : 0;
  const blastContentRow = {
    subject_template: "Hi {{first_name}}",
    body_template: "<p>Hi {{first_name}}</p>",
    from_name_override: null,
    audience_filter: null,
  };
  const blastUpdates: Record<string, unknown>[] = [];

  const rawFrom = (table: string) => {
    if (table === "tenants") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Test Tenant" }, error: null }) }) }) };
    }
    throw new Error(`unexpected raw() table: ${table}`);
  };

  const db = {
    raw: () => ({ from: rawFrom }),
    from(table: string) {
      if (table === "email_blasts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blastContentRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            blastUpdates.push(patch);
            // Chain supports both the .eq("id",..).neq("status","cancelled")
            // shape (materializeBlastAudience's own recipients_total write)
            // and a bare .eq("id",..) resolving directly (unused today, kept
            // for shape-compatibility with other update() callers).
            return { eq: () => ({ neq: () => Promise.resolve({ data: null, error: null }) }) };
          },
        };
      }
      if (table === "tenant_email_settings") {
        return {
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.maxRecipientsPerBlast !== undefined ? { max_recipients_per_blast: opts.maxRecipientsPerBlast } : null,
                error: null,
              }),
          }),
        };
      }
      if (table === "email_messages") {
        return {
          upsert: (rows: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates?: boolean }) => {
            if (opts.failUpsertAlways || upsertFailuresLeft > 0) {
              upsertFailuresLeft--;
              return Promise.resolve({ data: null, error: { message: "connection reset", code: "08006" } });
            }
            for (const row of rows) {
              const key = `${row.source_id}:${row.lead_id}`;
              if (options.ignoreDuplicates && messages.has(key)) continue;
              messages.set(key, row);
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { db, messages, blastUpdates };
}

describe("materializeBlastAudience", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
    buildUserAuthContextMock.mockReset();
    resolveAudienceMock.mockReset();
    buildUserAuthContextMock.mockResolvedValue(FULL_AUTH);
  });

  it("materializes exactly one row per lead, and a retried call does not double-materialize", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const first = await materializeBlastAudience("tenant-1", "blast-1", "user-1");
    expect(first).toEqual({ ok: true, sendable: 2, suppressed: 0 });
    expect(fake.messages.size).toBe(2);
    for (const row of fake.messages.values()) expect(row.status).toBe("queued");

    const second = await materializeBlastAudience("tenant-1", "blast-1", "user-1"); // simulates a retried step
    expect(second).toEqual({ ok: true, sendable: 2, suppressed: 0 });
    expect(fake.messages.size).toBe(2); // still exactly one row per lead — no duplicates
  });

  it("materializes a suppressed lead as status='suppressed', not a silent drop", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com")],
        suppressed: [audienceRow("lead-2", "optedout@example.com")],
        excluded: { noEmail: 0, malformed: 0, suppressed: 1, duplicateEmail: 0 },
      },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: true, sendable: 1, suppressed: 1 });
    const suppressedRow = [...fake.messages.values()].find((r) => r.lead_id === "lead-2");
    expect(suppressedRow?.status).toBe("suppressed");
  });

  it("chunks a large audience into multiple upsert calls, and still materializes every row", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const sendable = Array.from({ length: 250 }, (_, i) => audienceRow(`lead-${i}`, `lead${i}@example.com`));
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 250, sendable, suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result.ok).toBe(true);
    expect(fake.messages.size).toBe(250);
  });

  it("retries a chunk that fails transiently, and still succeeds", async () => {
    const fake = fakeMaterializeDb({ failUpsertOnce: true });
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result.ok).toBe(true); // the transient failure was retried, not surfaced
    expect(fake.messages.size).toBe(2);
  });

  it("gives up after exhausting retries and reports a real error, with nothing landed", async () => {
    const fake = fakeMaterializeDb({ failUpsertAlways: true });
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 1,
        sendable: [audienceRow("lead-1", "a@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result.ok).toBe(false);
    expect(fake.messages.size).toBe(0); // nothing landed — a retry can safely re-attempt every row
  });

  // F4 (docs/BLAST-FINDINGS-2026-09-06.md) — over-cap REJECTS rather than
  // truncates, and rejects BEFORE materialize, never leaving a partial
  // audience already written for a retry to build on.
  it("max_recipients_per_blast REJECTS rather than truncates — zero rows materialized", async () => {
    const fake = fakeMaterializeDb({ maxRecipientsPerBlast: 1 });
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("exceeds the 1-recipient cap") });
    expect(fake.messages.size).toBe(0);
  });

  it("no tenant_email_settings row (null cap) never blocks — falls back to the 2,000 default", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result.ok).toBe(true);
    expect(fake.messages.size).toBe(2);
  });

  it("an empty audience (nobody sendable or suppressed) is rejected, not silently materialized as zero rows", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 0, sendable: [], suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } },
    });
    const { materializeBlastAudience } = await import("./email-blast-send");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("no sendable recipients") });
  });

  // The defense-in-depth check mirroring send/route.ts's own synchronous
  // pre-check — see materializeBlastAudience's header comment for why a
  // restricted-scope sender can't be safely resolved from the background.
  it("refuses a sender with a restricted (own/branch) lead-visibility scope rather than silently under-resolving", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue({ ...FULL_AUTH, permissions: { leadScope: "own", pipelineAccess: "all" } });

    const { materializeBlastAudience } = await import("./email-blast-send");
    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("restricted lead-visibility scope") });
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });

  it("reports a clear error when the sender's permissions can't be resolved at all", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue(null);

    const { materializeBlastAudience } = await import("./email-blast-send");
    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result.ok).toBe(false);
  });
});

// emailBlastSend — draft/queued race regression. There's no atomicity between
// send/route.ts's inngest.send() and its own status update to 'queued', so
// this run's very first step (load-blast) can observe the row as EITHER
// 'draft' or 'queued'. These tests exercise the REAL handler (captured via
// the inngest.createFunction mock above) end-to-end with a fake `step` that
// runs each step.run() callback immediately, to prove the fix actually closes
// the gap rather than just unit-testing materializeBlastAudience in isolation.
interface FakeHandlerMessageRow {
  id: string;
  status: string;
  source: string;
  source_id: string;
}

function makeBlastTable(blast: Record<string, unknown>) {
  function updateNode(patch: Record<string, unknown>, filters: Array<() => boolean>) {
    return {
      eq: (col: string, val: unknown) => updateNode(patch, [...filters, () => col === "id" || blast[col] === val]),
      neq: (col: string, val: unknown) => updateNode(patch, [...filters, () => col === "id" || blast[col] !== val]),
      in: (col: string, vals: unknown[]) => updateNode(patch, [...filters, () => col === "id" || vals.includes(blast[col])]),
      then: (resolve: (v: { data: null; error: null }) => unknown, reject: (e: unknown) => unknown) => {
        if (filters.every((f) => f())) Object.assign(blast, patch);
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
  }
  return {
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blast }, error: null }) }) }),
    update: (patch: Record<string, unknown>) => updateNode(patch, []),
  };
}

function makeMessagesTable(messages: FakeHandlerMessageRow[]) {
  return {
    select: (cols: string) => {
      function node(filters: Array<(r: FakeHandlerMessageRow) => boolean>) {
        const shape = (r: FakeHandlerMessageRow) => (cols === "status" ? { status: r.status } : { id: r.id });
        return {
          eq: (col: keyof FakeHandlerMessageRow, val: unknown) => node([...filters, (r) => r[col] === val]),
          order: () => node(filters),
          limit: (n: number) => Promise.resolve({ data: messages.filter((r) => filters.every((f) => f(r))).slice(0, n).map(shape), error: null }),
          range: (from: number, to: number) =>
            Promise.resolve({ data: messages.filter((r) => filters.every((f) => f(r))).slice(from, to + 1).map(shape), error: null }),
        };
      }
      return node([]);
    },
    upsert: (rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        messages.push({ id: `msg-${messages.length}`, status: row.status as string, source: row.source as string, source_id: row.source_id as string });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function fakeHandlerDb(initialStatus: string) {
  const blast: Record<string, unknown> = {
    id: "blast-1",
    status: initialStatus,
    scheduled_for: null,
    subject_template: "Hi {{first_name}}",
    body_template: "<p>Hi {{first_name}}</p>",
    from_name_override: null,
    audience_filter: null,
  };
  const messages: FakeHandlerMessageRow[] = [];

  const db = {
    raw: () => ({
      from: (table: string) => {
        if (table === "tenants") {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Test Tenant" }, error: null }) }) }) };
        }
        throw new Error(`unexpected raw() table: ${table}`);
      },
    }),
    from(table: string) {
      if (table === "email_blasts") return makeBlastTable(blast);
      if (table === "email_messages") return makeMessagesTable(messages);
      if (table === "tenant_email_settings") return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) };
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { db, blast, messages };
}

describe("emailBlastSend — draft/queued race regression", () => {
  beforeEach(async () => {
    scopedClientForTenantMock.mockReset();
    buildUserAuthContextMock.mockReset();
    resolveAudienceMock.mockReset();
    sendQueuedEmailBatchMock.mockReset();
    inngestSendMock.mockReset();
    // Ensure the handler is captured — a no-op if an earlier test already
    // triggered the module's top-level createFunction() call.
    await import("./email-blast-send");
  });

  it("load-blast observing 'draft' (the race) still materializes exactly once, and the blast finishes normally instead of getting stuck", async () => {
    const fake = fakeHandlerDb("draft");
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue(FULL_AUTH);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 1,
        sendable: [audienceRow("lead-1", "a@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });
    sendQueuedEmailBatchMock.mockImplementation(async (_tenantId: string, ids: string[]) => {
      for (const id of ids) {
        const row = fake.messages.find((m) => m.id === id);
        if (row) row.status = "sent";
      }
      return { sent: ids.length, failed: 0, suppressed: 0, throttled: 0 };
    });

    await capturedHandler!({ event: { data: { tenantId: "tenant-1", blastId: "blast-1", senderId: "user-1" } }, step: fakeStep() });

    // Materialize ran exactly once despite load-blast seeing 'draft', not 'queued'.
    expect(resolveAudienceMock).toHaveBeenCalledTimes(1);
    expect(buildUserAuthContextMock).toHaveBeenCalledTimes(1);
    expect(fake.messages).toHaveLength(1);
    // The blast finished cleanly — confirm-queued closed the gap instead of
    // leaving it stuck at 'draft' forever.
    expect(fake.blast.status).toBe("sent");
  });

  it("a throttle-resume run (status='throttled') never re-triggers materialize", async () => {
    const fake = fakeHandlerDb("throttled");
    scopedClientForTenantMock.mockResolvedValue(fake.db);

    await capturedHandler!({ event: { data: { tenantId: "tenant-1", blastId: "blast-1" } }, step: fakeStep() });

    expect(resolveAudienceMock).not.toHaveBeenCalled();
    expect(buildUserAuthContextMock).not.toHaveBeenCalled();
  });

  it("mark-failed-no-audience's .neq(\"status\",\"cancelled\") guard never clobbers a blast cancelled mid-materialize", async () => {
    const fake = fakeHandlerDb("queued");
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue(FULL_AUTH);
    // Simulates /cancel landing at the exact moment materialize is resolving
    // the audience — by the time mark-failed-no-audience's update runs, the
    // row is already 'cancelled', not 'queued' or 'draft'.
    resolveAudienceMock.mockImplementation(async () => {
      fake.blast.status = "cancelled";
      return { ok: false, errors: { audience_filter: ["no longer valid"] } };
    });

    await capturedHandler!({ event: { data: { tenantId: "tenant-1", blastId: "blast-1", senderId: "user-1" } }, step: fakeStep() });

    expect(fake.blast.status).toBe("cancelled"); // never overwritten to 'failed'
  });
});
