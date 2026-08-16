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

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: vi.fn(() => ({})) } }));

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
