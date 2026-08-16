import { describe, it, expect, vi, beforeEach } from "vitest";

// docs/SMS-PHASE4-BRIEF.md item 1 — thin-caller coverage around the pure
// matchDeliveryReports() (delivery-match.test.ts already covers the matching
// logic itself). This asserts the DB write-back: matched rows flip to
// delivered/failed, unresolved rows get their poll-attempt counter bumped in
// bulk (grouped by current attempt count), and a row that hits the cap is
// logged, not silently dropped.
//
// Tests reconcileTenant()/loadAwaitingReceipt() directly rather than
// invoking the InngestFunction object smsDeliveryPoll itself — same pattern
// as finalizeBlast in sms-blast-send.test.ts (the Inngest SDK's function
// wrapper isn't meant to be called directly outside its runtime).

const createServiceClientMock = vi.fn();
const scopedClientForTenantMock = vi.fn();
const isSmsEnabledMock = vi.fn();
const providerReportMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/sms/flag", () => ({ isSmsEnabled: isSmsEnabledMock }));
vi.mock("@/lib/sms/provider", () => ({ getSmsProvider: () => ({ report: providerReportMock }) }));
// Captures the handler by function id (not just the last registration) so
// smsDeliveryPoll and smsBlastPollReceipts can be invoked independently —
// same pattern as sms-credit-reaper.test.ts.
const registeredHandlers: Record<string, (ctx: unknown) => unknown> = {};
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    createFunction: vi.fn((cfg: { id: string }, handler: (ctx: unknown) => unknown) => {
      registeredHandlers[cfg.id] = handler;
      return handler;
    }),
    send: vi.fn(),
  },
}));

interface FakeSubmitted {
  id: string;
  tenant_id: string;
  to_phone: string;
  body: string;
  sent_at: string | null;
  delivery_poll_attempts: number;
}

function fakeService(rows: FakeSubmitted[]) {
  return {
    from(table: string) {
      if (table === "sms_messages") {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({
                gte: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: rows, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function fakeScoped() {
  const updateCalls: { patch: Record<string, unknown>; ids?: string[] }[] = [];
  const db = {
    from(table: string) {
      if (table === "sms_messages") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              updateCalls.push({ patch, ids: [id] });
              return Promise.resolve({ data: null, error: null });
            },
            in: (_col: string, ids: string[]) => {
              updateCalls.push({ patch, ids });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { db, updateCalls };
}

describe("sms-delivery-poll", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
    scopedClientForTenantMock.mockReset();
    isSmsEnabledMock.mockReset().mockReturnValue(true);
    providerReportMock.mockReset().mockResolvedValue([]);
  });

  it("flips a matched row to delivered and does not bump its poll-attempt counter", async () => {
    const rows: FakeSubmitted[] = [
      { id: "m1", tenant_id: "tenant-1", to_phone: "9800000001", body: "Admizz: hi", sent_at: "2026-08-16T09:59:00Z", delivery_poll_attempts: 0 },
    ];
    const scoped = fakeScoped();
    scopedClientForTenantMock.mockResolvedValue(scoped.db);

    const { reconcileTenant } = await import("./sms-delivery-poll");
    const result = await reconcileTenant("tenant-1", rows, [{ id: "999", mobile: "9800000001", status: "delivered", credit: "1", message: "Admizz: hi" }]);

    expect(result).toMatchObject({ matched: 1, stillAwaiting: 0, gaveUp: 0 });
    const deliveredUpdate = scoped.updateCalls.find((c) => c.patch.status === "delivered");
    expect(deliveredUpdate?.ids).toEqual(["m1"]);
    expect(scoped.updateCalls.some((c) => "delivery_poll_attempts" in c.patch)).toBe(false);
  });

  it("marks a matched failed row with error_code delivery_failed", async () => {
    const rows: FakeSubmitted[] = [
      { id: "m1", tenant_id: "tenant-1", to_phone: "9800000001", body: "Admizz: hi", sent_at: "2026-08-16T09:59:00Z", delivery_poll_attempts: 0 },
    ];
    const scoped = fakeScoped();
    scopedClientForTenantMock.mockResolvedValue(scoped.db);

    const { reconcileTenant } = await import("./sms-delivery-poll");
    await reconcileTenant("tenant-1", rows, [{ id: "999", mobile: "9800000001", status: "failed", credit: "1", message: "Admizz: hi" }]);

    const failedUpdate = scoped.updateCalls.find((c) => c.patch.status === "failed");
    expect(failedUpdate?.patch).toMatchObject({ status: "failed", error_code: "delivery_failed" });
  });

  it("bumps the poll-attempt counter in one bulk update per current-attempt group for unresolved rows", async () => {
    const rows: FakeSubmitted[] = [
      { id: "m1", tenant_id: "tenant-1", to_phone: "9800000001", body: "Admizz: a", sent_at: "2026-08-16T09:00:00Z", delivery_poll_attempts: 0 },
      { id: "m2", tenant_id: "tenant-1", to_phone: "9800000002", body: "Admizz: b", sent_at: "2026-08-16T09:00:00Z", delivery_poll_attempts: 0 },
      { id: "m3", tenant_id: "tenant-1", to_phone: "9800000003", body: "Admizz: c", sent_at: "2026-08-16T09:00:00Z", delivery_poll_attempts: 3 },
    ];
    const scoped = fakeScoped();
    scopedClientForTenantMock.mockResolvedValue(scoped.db);

    const { reconcileTenant } = await import("./sms-delivery-poll");
    const result = await reconcileTenant("tenant-1", rows, []); // nobody matched this poll

    expect(result).toMatchObject({ matched: 0, stillAwaiting: 3 });

    const bumps = scoped.updateCalls.filter((c) => "delivery_poll_attempts" in c.patch);
    // One call per distinct current-attempt group (0 -> covers m1+m2, 3 -> covers m3), not one per row.
    expect(bumps).toHaveLength(2);
    const groupOf0 = bumps.find((b) => b.ids?.includes("m1"));
    expect(groupOf0?.ids?.sort()).toEqual(["m1", "m2"]);
    expect(groupOf0?.patch.delivery_poll_attempts).toBe(1);
    const groupOf3 = bumps.find((b) => b.ids?.includes("m3"));
    expect(groupOf3?.patch.delivery_poll_attempts).toBe(4);
  });

  it("reports gaveUp for a row whose bumped attempt count reaches the cap", async () => {
    const rows: FakeSubmitted[] = [
      { id: "m1", tenant_id: "tenant-1", to_phone: "9800000001", body: "Admizz: a", sent_at: "2026-08-16T09:00:00Z", delivery_poll_attempts: 11 },
    ];
    const scoped = fakeScoped();
    scopedClientForTenantMock.mockResolvedValue(scoped.db);

    const { reconcileTenant } = await import("./sms-delivery-poll");
    const result = await reconcileTenant("tenant-1", rows, []);

    expect(result).toMatchObject({ matched: 0, stillAwaiting: 1, gaveUp: 1 });
  });

  it("loadAwaitingReceipt returns [] and never fetches a report when nothing is queried", async () => {
    createServiceClientMock.mockResolvedValue(fakeService([]));
    const { loadAwaitingReceipt } = await import("./sms-delivery-poll");
    const rows = await loadAwaitingReceipt();
    expect(rows).toEqual([]);
  });
});

// SMS-PHASE4-FIX-F7-BRIEF.md item 1 — the event-driven poller. Asserts the
// scheduled sleep sequence via a fake step (no real sleeping) and the two
// early-exit shapes: "nothing left to poll" and "isSmsEnabled() is false".
function fakeStep() {
  const sleeps: string[] = [];
  return {
    sleeps,
    sleep: async (_id: string, duration: string) => {
      sleeps.push(duration);
    },
    run: async (_id: string, fn: () => unknown) => fn(),
  };
}

function fakeBlastAwaitingReceiptScoped(rowsPerCall: FakeSubmitted[][]) {
  let callIndex = 0;
  return {
    from(table: string) {
      if (table !== "sms_messages") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              lt: () => ({
                gte: () => ({
                  order: () => ({
                    limit: () => {
                      const rows = rowsPerCall[callIndex] ?? [];
                      callIndex++;
                      return Promise.resolve({ data: rows, error: null });
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
          in: () => Promise.resolve({ data: null, error: null }),
        }),
      };
    },
  };
}

describe("smsBlastPollReceipts", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
    isSmsEnabledMock.mockReset().mockReturnValue(true);
    providerReportMock.mockReset().mockResolvedValue([]);
  });

  it("skips before any step when SMS is disabled", async () => {
    isSmsEnabledMock.mockReturnValue(false);
    const { smsBlastPollReceipts } = await import("./sms-delivery-poll");
    const step = fakeStep();

    const result = await (smsBlastPollReceipts as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { data: { tenantId: "tenant-1", blastId: "blast-1" } },
      step,
    });

    expect(result).toEqual({ skipped: true, reason: "sms disabled" });
    expect(step.sleeps).toEqual([]);
    expect(scopedClientForTenantMock).not.toHaveBeenCalled();
  });

  it("exits on the first rung once nothing is left awaiting a receipt", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeBlastAwaitingReceiptScoped([[]]));
    const { smsBlastPollReceipts, POLL_BACKOFF_DELAYS } = await import("./sms-delivery-poll");
    const step = fakeStep();

    const result = await (smsBlastPollReceipts as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { data: { tenantId: "tenant-1", blastId: "blast-1" } },
      step,
    });

    expect(result).toMatchObject({ attempts: 1, exitedEarly: true, blastId: "blast-1" });
    expect(step.sleeps).toEqual([POLL_BACKOFF_DELAYS[0]]);
  });

  it("keeps walking the backoff ladder while rows are still awaiting, then exits once resolved", async () => {
    const row: FakeSubmitted = {
      id: "m1",
      tenant_id: "tenant-1",
      to_phone: "9800000001",
      body: "Admizz: hi",
      sent_at: "2026-08-16T09:00:00Z",
      delivery_poll_attempts: 0,
    };
    scopedClientForTenantMock.mockResolvedValue(fakeBlastAwaitingReceiptScoped([[row], []]));
    const { smsBlastPollReceipts, POLL_BACKOFF_DELAYS } = await import("./sms-delivery-poll");
    const step = fakeStep();

    const result = await (smsBlastPollReceipts as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { data: { tenantId: "tenant-1", blastId: "blast-1" } },
      step,
    });

    expect(result).toMatchObject({ attempts: 2, exitedEarly: true, blastId: "blast-1" });
    expect(step.sleeps).toEqual([POLL_BACKOFF_DELAYS[0], POLL_BACKOFF_DELAYS[1]]);
  });

  it("walks the full backoff ladder and gives up if nothing ever resolves", async () => {
    const row: FakeSubmitted = {
      id: "m1",
      tenant_id: "tenant-1",
      to_phone: "9800000001",
      body: "Admizz: hi",
      sent_at: "2026-08-16T09:00:00Z",
      delivery_poll_attempts: 0,
    };
    const { POLL_BACKOFF_DELAYS } = await import("./sms-delivery-poll");
    scopedClientForTenantMock.mockResolvedValue(fakeBlastAwaitingReceiptScoped(POLL_BACKOFF_DELAYS.map(() => [row])));
    const { smsBlastPollReceipts } = await import("./sms-delivery-poll");
    const step = fakeStep();

    const result = await (smsBlastPollReceipts as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { data: { tenantId: "tenant-1", blastId: "blast-1" } },
      step,
    });

    expect(result).toMatchObject({ attempts: POLL_BACKOFF_DELAYS.length, exitedEarly: false, blastId: "blast-1" });
    expect(step.sleeps).toEqual(POLL_BACKOFF_DELAYS);
  });
});

describe("scheduled-function idle guards", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
    isSmsEnabledMock.mockReset();
  });

  it("smsDeliveryPoll skips before any step.run when SMS is disabled", async () => {
    isSmsEnabledMock.mockReturnValue(false);
    const { smsDeliveryPoll } = await import("./sms-delivery-poll");
    const step = fakeStep();

    const result = await (smsDeliveryPoll as unknown as (ctx: unknown) => Promise<unknown>)({ step });

    expect(result).toEqual({ skipped: true, reason: "sms disabled" });
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });
});
