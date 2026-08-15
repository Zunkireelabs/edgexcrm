import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression coverage for the §2d safety net (SMS-PHASE2-BRIEF.md): a message
// whose recipient landed on sms_suppressions between materialization and send
// must be dropped — status flipped to 'suppressed', never handed to the
// provider — while the rest of the batch still sends normally. Unit-mocked
// (no DB): scopedClientForTenant and the provider are faked so this runs in
// CI, which has no database.

const scopedClientForTenantMock = vi.fn();
const getSmsProviderMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("./provider", () => ({ getSmsProvider: getSmsProviderMock }));

function makeQueryBuilder<T>(resolve: () => T) {
  const builder: Record<string, unknown> = {
    in: () => builder,
    eq: () => builder,
    then: (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return builder;
}

interface QueuedRow {
  id: string;
  tenant_id: string;
  to_phone: string;
  body: string;
}

function fakeDb(messages: QueuedRow[], suppressedPhonesE164: string[]) {
  const updateCalls: { table: string; values: Record<string, unknown> }[] = [];
  return {
    updateCalls,
    from(table: string) {
      return {
        select() {
          if (table === "sms_messages") {
            return makeQueryBuilder(() => ({ data: messages, error: null }));
          }
          if (table === "sms_suppressions") {
            return makeQueryBuilder(() => ({
              data: suppressedPhonesE164.map((phone_e164) => ({ phone_e164 })),
              error: null,
            }));
          }
          throw new Error(`unexpected select on ${table}`);
        },
        update(values: Record<string, unknown>) {
          updateCalls.push({ table, values });
          return makeQueryBuilder(() => ({ data: null, error: null }));
        },
      };
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SMS_SANDBOX = "false";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("sendQueuedBatch — suppression safety net", () => {
  it("drops a suppressed recipient before the provider call, and still sends the rest", async () => {
    const messages: QueuedRow[] = [
      { id: "m1", tenant_id: "t1", to_phone: "9800000001", body: "Hello" },
      { id: "m2", tenant_id: "t1", to_phone: "9800000002", body: "Hello" },
    ];
    const db = fakeDb(messages, ["+9779800000001"]);
    scopedClientForTenantMock.mockResolvedValue(db);

    const sendMock = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        valid: [{ id: "p2", mobile: "9800000002", credit: 1, network: "ntc", status: "queued", shortcode: "AT_Alert" }],
        invalid: [],
      },
    });
    getSmsProviderMock.mockReturnValue({ send: sendMock });

    const { sendQueuedBatch } = await import("./send");
    const result = await sendQueuedBatch("t1", ["m1", "m2"]);

    // The provider is only ever called with the non-suppressed recipient.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual(["9800000002"]);

    // m1 was flipped to 'suppressed', never marked sent/failed.
    const suppressUpdate = db.updateCalls.find((c) => c.values.status === "suppressed");
    expect(suppressUpdate).toBeDefined();

    // m2 still sent normally.
    const submittedUpdate = db.updateCalls.find((c) => c.values.status === "submitted");
    expect(submittedUpdate).toBeDefined();
    expect(submittedUpdate?.values.shortcode).toBe("AT_Alert");

    expect(result).toEqual({ sent: 1, failed: 0, totalCreditsCharged: 1 });
  });

  it("returns a zero result without calling the provider when every recipient is suppressed", async () => {
    const messages: QueuedRow[] = [{ id: "m1", tenant_id: "t1", to_phone: "9800000001", body: "Hello" }];
    const db = fakeDb(messages, ["+9779800000001"]);
    scopedClientForTenantMock.mockResolvedValue(db);

    const sendMock = vi.fn();
    getSmsProviderMock.mockReturnValue({ send: sendMock });

    const { sendQueuedBatch } = await import("./send");
    const result = await sendQueuedBatch("t1", ["m1"]);

    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, totalCreditsCharged: 0 });
    expect(db.updateCalls.some((c) => c.values.status === "suppressed")).toBe(true);
  });
});
