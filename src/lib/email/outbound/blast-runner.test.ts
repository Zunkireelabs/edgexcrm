import { describe, it, expect, vi, beforeEach } from "vitest";

// Ported from the old src/lib/inngest/functions/email-blast-send.test.ts when
// blast sending moved off Inngest (2026-09-28) — same coverage for the
// business logic (computeBlastCounts, finalizeEmailBlast,
// materializeBlastAudience), plus processOneBlast tests replacing the old
// draft/queued-race-via-Inngest-handler tests (that race no longer exists:
// send/route.ts now does its own status write synchronously before
// scheduling the background call, so there's nothing left to race against).

const scopedClientForTenantMock = vi.fn();
const buildUserAuthContextMock = vi.fn();
const resolveAudienceMock = vi.fn();
const sendQueuedEmailBatchMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: buildUserAuthContextMock }));
vi.mock("@/lib/email/outbound/audience", () => ({ resolveAudience: resolveAudienceMock }));
vi.mock("@/lib/email/outbound/send", () => ({ sendQueuedEmailBatch: sendQueuedEmailBatchMock }));

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

describe("computeBlastCounts", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("recomputes sent/failed/suppressed live from email_messages", async () => {
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
    const { computeBlastCounts } = await import("./blast-runner");

    const counts = await computeBlastCounts("tenant-1", "blast-throttled");

    expect(counts.sent).toBe(3);
    expect(counts.failed).toBe(1);
    expect(counts.suppressed).toBe(1);
    expect(counts.cancelled).toBe(0);
  });

  it("counts every row across a real Admizz-scale (3000+) blast, not just the first 1000", async () => {
    const rows: FakeMessageRow[] = [
      ...Array.from({ length: 2000 }, () => ({ status: "sent" })),
      ...Array.from({ length: 1118 }, () => ({ status: "queued" })),
    ];
    const fake = fakeDb("throttled", rows);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./blast-runner");

    const counts = await computeBlastCounts("tenant-1", "blast-large");

    expect(counts.sent).toBe(2000);
  });

  it("total reflects every row regardless of status, including ones no bucket counts", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "queued" }, { status: "sending" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./blast-runner");

    const counts = await computeBlastCounts("tenant-1", "blast-1");

    expect(counts.total).toBe(3);
    expect(counts.sent + counts.failed + counts.cancelled + counts.suppressed).toBe(1);
  });
});

describe("finalizeEmailBlast — F-1 (cancel never overwritten) / F5 (never a false 'sent')", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("a blast already cancelled stays cancelled — never overwritten to failed/partially_failed", async () => {
    const fake = fakeDb("cancelled", [{ status: "sent" }, { status: "cancelled" }, { status: "cancelled" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./blast-runner");

    const result = await finalizeEmailBlast("tenant-1", "blast-1");

    expect(result.finalStatus).toBe("cancelled");
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(2);
  });

  it("natural completion with no failures finalizes sent", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./blast-runner");

    const result = await finalizeEmailBlast("tenant-1", "blast-3");

    expect(result.finalStatus).toBe("sent");
  });

  it("mixed sent/failed with no cancellation finalizes partially_failed", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "failed" }, { status: "bounced" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./blast-runner");

    const result = await finalizeEmailBlast("tenant-1", "blast-4");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.failed).toBe(2);
  });

  it("rows still 'queued' at finalize time -> partially_failed, never a false 'sent'", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }, { status: "queued" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./blast-runner");

    const result = await finalizeEmailBlast("tenant-1", "blast-unaccounted-1");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(2);
  });
});

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

function fakeMaterializeDb(
  opts: { failUpsertOnce?: boolean; failUpsertAlways?: boolean; maxRecipientsPerBlast?: number; failPermanentlyAfterRows?: number } = {}
) {
  const messages = new Map<string, Record<string, unknown>>();
  let upsertFailuresLeft = opts.failUpsertOnce ? 1 : 0;
  const blastContentRow = { subject_template: "Hi {{first_name}}", body_template: "<p>Hi {{first_name}}</p>", from_name_override: null, audience_filter: null };
  const blastUpdates: Record<string, unknown>[] = [];

  const db = {
    raw: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Test Tenant" }, error: null }) }) }) }) }),
    from(table: string) {
      if (table === "email_blasts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blastContentRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            blastUpdates.push(patch);
            return { eq: () => ({ neq: () => Promise.resolve({ data: null, error: null }) }) };
          },
        };
      }
      if (table === "tenant_email_settings") {
        return {
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.maxRecipientsPerBlast !== undefined ? { max_recipients_per_blast: opts.maxRecipientsPerBlast } : null, error: null }),
          }),
        };
      }
      if (table === "email_messages") {
        return {
          upsert: (rows: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates?: boolean }) => {
            if (opts.failUpsertAlways || upsertFailuresLeft > 0 || (opts.failPermanentlyAfterRows !== undefined && messages.size >= opts.failPermanentlyAfterRows)) {
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
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  range: (from: number, to: number) => {
                    const statuses = Array.from(messages.values()).map((m) => ({ status: m.status }));
                    return Promise.resolve({ data: statuses.slice(from, to + 1), error: null });
                  },
                }),
              }),
            }),
          }),
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
      audience: { matched: 2, sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")], suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } },
    });
    const { materializeBlastAudience } = await import("./blast-runner");

    const first = await materializeBlastAudience("tenant-1", "blast-1", "user-1");
    expect(first).toEqual({ ok: true, sendable: 2, suppressed: 0 });

    const second = await materializeBlastAudience("tenant-1", "blast-1", "user-1");
    expect(second).toEqual({ ok: true, sendable: 2, suppressed: 0 });
    expect(fake.messages.size).toBe(2);
  });

  it("max_recipients_per_blast REJECTS rather than truncates", async () => {
    const fake = fakeMaterializeDb({ maxRecipientsPerBlast: 1 });
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 2, sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")], suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } },
    });
    const { materializeBlastAudience } = await import("./blast-runner");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("exceeds the 1-recipient cap") });
  });

  it("a chunk failing AFTER earlier chunks already committed does NOT discard those rows or report total failure", async () => {
    const fake = fakeMaterializeDb({ failPermanentlyAfterRows: 100 });
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const sendable = Array.from({ length: 250 }, (_, i) => audienceRow(`lead-${i}`, `lead${i}@example.com`));
    resolveAudienceMock.mockResolvedValue({ ok: true, audience: { matched: 250, sendable, suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } } });
    const { materializeBlastAudience } = await import("./blast-runner");

    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(fake.messages.size).toBe(100);
    expect(result).toEqual({ ok: true, sendable: 100, suppressed: 0 });
  });

  it("refuses a sender with a restricted (own/branch) lead-visibility scope", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue({ ...FULL_AUTH, permissions: { leadScope: "own", pipelineAccess: "all" } });

    const { materializeBlastAudience } = await import("./blast-runner");
    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("restricted lead-visibility scope") });
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });

  it("an empty audience is rejected, not silently materialized as zero rows", async () => {
    const fake = fakeMaterializeDb();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    resolveAudienceMock.mockResolvedValue({ ok: true, audience: { matched: 0, sendable: [], suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } } });

    const { materializeBlastAudience } = await import("./blast-runner");
    const result = await materializeBlastAudience("tenant-1", "blast-1", "user-1");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("no sendable recipients") });
  });
});

// processOneBlast — replaces the old Inngest-handler-level regression tests.
// The draft/queued race those tests guarded against no longer exists (see
// this file's header comment), so this coverage instead exercises the new
// invariants: the periodic (no-senderId) scan never materializes a fresh
// blast itself, and a cancel racing materialize is still honored.
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

interface FakeHandlerMessageRow {
  id: string;
  status: string;
  source: string;
  source_id: string;
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
          range: (from: number, to: number) => Promise.resolve({ data: messages.filter((r) => filters.every((f) => f(r))).slice(from, to + 1).map(shape), error: null }),
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
    update: (patch: Record<string, unknown>) => {
      function node(filters: Array<(r: FakeHandlerMessageRow) => boolean>) {
        return {
          eq: (col: keyof FakeHandlerMessageRow, val: unknown) => node([...filters, (r) => r[col] === val]),
          then: (resolve: (v: { data: null; error: null }) => unknown, reject: (e: unknown) => unknown) => {
            for (const row of messages) {
              if (filters.every((f) => f(row))) Object.assign(row, patch);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
      }
      return node([]);
    },
  };
}

function fakeHandlerDb(initialStatus: string, extra: Record<string, unknown> = {}) {
  const blast: Record<string, unknown> = {
    id: "blast-1",
    status: initialStatus,
    scheduled_for: null,
    recipients_total: null,
    started_at: new Date().toISOString(),
    subject_template: "Hi {{first_name}}",
    body_template: "<p>Hi {{first_name}}</p>",
    from_name_override: null,
    audience_filter: null,
    ...extra,
  };
  const messages: FakeHandlerMessageRow[] = [];

  const db = {
    raw: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Test Tenant" }, error: null }) }) }) }) }),
    from(table: string) {
      if (table === "email_blasts") return makeBlastTable(blast);
      if (table === "email_messages") return makeMessagesTable(messages);
      if (table === "tenant_email_settings") return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) };
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { db, blast, messages };
}

describe("processOneBlast", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
    buildUserAuthContextMock.mockReset();
    resolveAudienceMock.mockReset();
    sendQueuedEmailBatchMock.mockReset();
  });

  it("with a senderId, materializes and drives a fresh queued blast to completion", async () => {
    const fake = fakeHandlerDb("queued");
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue(FULL_AUTH);
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 1, sendable: [audienceRow("lead-1", "a@example.com")], suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } },
    });
    sendQueuedEmailBatchMock.mockImplementation(async (_tenantId: string, ids: string[]) => {
      for (const id of ids) {
        const row = fake.messages.find((m) => m.id === id);
        if (row) row.status = "sent";
      }
      return { sent: ids.length, failed: 0, suppressed: 0, throttled: 0 };
    });

    const outcome = await processOneBlastImport(fake, "tenant-1", "blast-1", "user-1");

    expect(resolveAudienceMock).toHaveBeenCalledTimes(1);
    expect(fake.messages).toHaveLength(1);
    expect(fake.blast.status).toBe("sent");
    expect(outcome.finalStatus).toBe("sent");
  });

  it("without a senderId (periodic scan), a freshly queued un-materialized blast is skipped, not failed, within the grace period", async () => {
    const fake = fakeHandlerDb("queued", { started_at: new Date().toISOString() });
    scopedClientForTenantMock.mockResolvedValue(fake.db);

    const outcome = await processOneBlastImport(fake, "tenant-1", "blast-1");

    expect(resolveAudienceMock).not.toHaveBeenCalled();
    expect(fake.blast.status).toBe("queued");
    expect(outcome.skipped).toBe(true);
  });

  it("without a senderId, a queued-and-un-materialized blast past the grace period is marked failed loudly", async () => {
    const fake = fakeHandlerDb("queued", { started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    scopedClientForTenantMock.mockResolvedValue(fake.db);

    const outcome = await processOneBlastImport(fake, "tenant-1", "blast-1");

    expect(fake.blast.status).toBe("failed");
    expect(outcome.failed).toBe(true);
  });

  it("a blast already materialized (recipients_total set) is driven to completion even with no senderId", async () => {
    const fake = fakeHandlerDb("throttled", { recipients_total: 1 });
    fake.messages.push({ id: "msg-0", status: "queued", source: "blast", source_id: "blast-1" });
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    sendQueuedEmailBatchMock.mockImplementation(async (_tenantId: string, ids: string[]) => {
      for (const id of ids) {
        const row = fake.messages.find((m) => m.id === id);
        if (row) row.status = "sent";
      }
      return { sent: ids.length, failed: 0, suppressed: 0, throttled: 0 };
    });

    const outcome = await processOneBlastImport(fake, "tenant-1", "blast-1");

    expect(buildUserAuthContextMock).not.toHaveBeenCalled();
    expect(fake.blast.status).toBe("sent");
    expect(outcome.finalStatus).toBe("sent");
  });

  it("a cancel racing materialize is honored — never overwritten to failed", async () => {
    const fake = fakeHandlerDb("queued");
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    buildUserAuthContextMock.mockResolvedValue(FULL_AUTH);
    resolveAudienceMock.mockImplementation(async () => {
      fake.blast.status = "cancelled";
      return { ok: true, audience: { matched: 1, sendable: [audienceRow("lead-1", "a@example.com")], suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 } } };
    });

    const outcome = await processOneBlastImport(fake, "tenant-1", "blast-1", "user-1");

    expect(fake.blast.status).toBe("cancelled");
    expect(outcome.finalStatus).toBe("cancelled");
  });

  it("a scheduled-future blast is parked, not sent, until due", async () => {
    const fake = fakeHandlerDb("queued", { recipients_total: 1, scheduled_for: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    fake.messages.push({ id: "msg-0", status: "queued", source: "blast", source_id: "blast-1" });
    scopedClientForTenantMock.mockResolvedValue(fake.db);

    const outcome = await processOneBlastImport(fake, "tenant-1", "blast-1");

    expect(outcome.parked).toBe(true);
    expect(fake.blast.status).toBe("queued");
    expect(sendQueuedEmailBatchMock).not.toHaveBeenCalled();
  });
});

// Small indirection so every test above imports the module fresh under the
// same mocked dependencies without repeating the dynamic import inline.
async function processOneBlastImport(_fake: unknown, tenantId: string, blastId: string, senderId?: string) {
  const { processOneBlast } = await import("./blast-runner");
  return processOneBlast(tenantId, blastId, senderId);
}
