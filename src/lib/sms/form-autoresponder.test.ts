import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-mocked (no DB, no provider): every collaborator is faked so this runs in CI and locally
// without touching any database. The compose/render path is REAL, so merge tags, the sender label
// and the opt-out footer are exercised for real.

const {
  scopedClientForTenantMock,
  isSmsEnabledForTenantMock,
  loadTenantSmsSettingsMock,
  loadSuppressedPhonesMock,
  getOrCreateOptOutTokenMock,
  sendQueuedBatchMock,
} = vi.hoisted(() => ({
  scopedClientForTenantMock: vi.fn(),
  isSmsEnabledForTenantMock: vi.fn(),
  loadTenantSmsSettingsMock: vi.fn(),
  loadSuppressedPhonesMock: vi.fn(),
  getOrCreateOptOutTokenMock: vi.fn(),
  sendQueuedBatchMock: vi.fn(),
}));

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("./flag", () => ({ isSmsEnabledForTenant: isSmsEnabledForTenantMock }));
vi.mock("./settings", () => ({ loadTenantSmsSettings: loadTenantSmsSettingsMock }));
vi.mock("./suppression", () => ({ loadSuppressedPhones: loadSuppressedPhonesMock }));
vi.mock("./optout", async () => {
  const actual = await vi.importActual<typeof import("./optout")>("./optout");
  return { ...actual, getOrCreateOptOutToken: getOrCreateOptOutTokenMock };
});
vi.mock("./send", () => ({ sendQueuedBatch: sendQueuedBatchMock }));

import { processFormSmsAutoresponder, SMS_FORM_REF_TYPE } from "./form-autoresponder";
import { DEFAULT_TENANT_SMS_SETTINGS } from "./compose";
import type { FormConfig, FormSmsAutoresponder, Lead } from "@/types/database";

interface FakeDbOpts {
  recentRows?: { id: string }[];
  insertError?: { message: string } | null;
  reserve?: { data: unknown; error: unknown };
}

function fakeDb(opts: FakeDbOpts = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const lookupFilters: [string, unknown][] = [];
  const db = {
    lookupFilters,
    inserts,
    updates,
    rpcCalls,
    from(table: string) {
      if (table !== "sms_messages") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const b: Record<string, unknown> = {
            eq: (col: string, val: unknown) => {
              lookupFilters.push([col, val]);
              return b;
            },
            gte: () => b,
            limit: () => b,
            then: (f: (v: unknown) => unknown) => Promise.resolve({ data: opts.recentRows ?? [], error: null }).then(f),
          };
          return b;
        },
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  opts.insertError
                    ? { data: null, error: opts.insertError }
                    : { data: { id: "msg-1" }, error: null }
                ),
            }),
          };
        },
        update(values: Record<string, unknown>) {
          updates.push(values);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "sms_credits_reserve") {
        return Promise.resolve(opts.reserve ?? { data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
  return db;
}

function makeForm(sms: Partial<FormSmsAutoresponder> | null = {}): FormConfig {
  return {
    id: "form-1",
    autoresponder:
      sms === null
        ? undefined
        : {
            enabled: false,
            fire_mode: "every",
            subject: "",
            body_html: "",
            sms: { enabled: true, fire_mode: "every", body: "Hi {{first_name}}, thanks! Ref {{course}}.", ...sms },
          },
  } as unknown as FormConfig;
}

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    tenant_id: "tenant-1",
    first_name: "Asha",
    phone: "+977-9812345678",
    custom_fields: { course: "IELTS" },
    ...over,
  } as unknown as Lead;
}

beforeEach(() => {
  vi.resetAllMocks();
  isSmsEnabledForTenantMock.mockResolvedValue(true);
  loadTenantSmsSettingsMock.mockResolvedValue({ ...DEFAULT_TENANT_SMS_SETTINGS, sender_label: "Admizz:" });
  loadSuppressedPhonesMock.mockResolvedValue(new Set());
  getOrCreateOptOutTokenMock.mockResolvedValue("TOKEN12345");
  sendQueuedBatchMock.mockResolvedValue({ sent: 1, failed: 0, totalCreditsCharged: 1 });
});

describe("processFormSmsAutoresponder — skips that must never text or charge", () => {
  it.each([
    ["no sms config at all", makeForm(null), makeLead(), { isResubmission: false }, "disabled"],
    ["disabled", makeForm({ enabled: false }), makeLead(), { isResubmission: false }, "disabled"],
    ["blank body", makeForm({ body: "   " }), makeLead(), { isResubmission: false }, "empty_body"],
    ["first-only on a resubmission", makeForm({ fire_mode: "first" }), makeLead(), { isResubmission: true }, "resubmission"],
    ["lead has no phone", makeForm(), makeLead({ phone: null }), { isResubmission: false }, "phone_missing"],
    ["non-Nepal number", makeForm(), makeLead({ phone: "+1-4155550123" }), { isResubmission: false }, "phone_foreign"],
    ["malformed Nepal number", makeForm(), makeLead({ phone: "+977-12345" }), { isResubmission: false }, "phone_malformed"],
  ])("%s", async (_name, form, lead, opts, reason) => {
    const db = fakeDb();
    scopedClientForTenantMock.mockResolvedValue(db);
    const out = await processFormSmsAutoresponder(form, lead, opts);
    expect(out).toEqual({ status: "skipped", reason });
    expect(db.inserts).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("tenant without SMS enabled", async () => {
    isSmsEnabledForTenantMock.mockResolvedValue(false);
    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });
    expect(out).toEqual({ status: "skipped", reason: "sms_not_enabled_for_tenant" });
    expect(scopedClientForTenantMock).not.toHaveBeenCalled();
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("duplicate: already texted this NUMBER for this form in the window (keyed on phone, not lead)", async () => {
    const db = fakeDb({ recentRows: [{ id: "earlier" }] });
    scopedClientForTenantMock.mockResolvedValue(db);
    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });
    expect(out).toEqual({ status: "skipped", reason: "duplicate" });
    // A resubmission can create a NEW lead row for the same person, so the lookup must not use lead_id.
    expect(db.lookupFilters).toContainEqual(["to_phone", "9812345678"]);
    expect(db.lookupFilters).toContainEqual(["form_config_id", "form-1"]);
    expect(db.lookupFilters.some(([col]) => col === "lead_id")).toBe(false);
    expect(db.inserts).toHaveLength(0);
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("opted-out number: never queued, never charged", async () => {
    const db = fakeDb();
    scopedClientForTenantMock.mockResolvedValue(db);
    loadSuppressedPhonesMock.mockResolvedValue(new Set(["+9779812345678"]));
    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });
    expect(out).toEqual({ status: "skipped", reason: "suppressed" });
    expect(db.inserts).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });
});

describe("processFormSmsAutoresponder — sending", () => {
  it("queues the fully rendered message, reserves, sends, then settles with the actual charge", async () => {
    const db = fakeDb();
    scopedClientForTenantMock.mockResolvedValue(db);
    sendQueuedBatchMock.mockResolvedValue({ sent: 1, failed: 0, totalCreditsCharged: 2 });

    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });

    expect(out).toEqual({ status: "sent", messageId: "msg-1" });
    expect(db.inserts).toHaveLength(1);
    const row = db.inserts[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      lead_id: "lead-1",
      form_config_id: "form-1",
      source: "form_autoresponder",
      to_phone: "9812345678",
      status: "queued",
    });
    // Merge tags (a real lead column AND a custom-field answer), sender label and opt-out footer.
    expect(row.body).toContain("Admizz:");
    expect(row.body).toContain("Hi Asha, thanks! Ref IELTS.");
    expect(row.body).toContain("TOKEN12345");

    const reserve = db.rpcCalls.find((c) => c.fn === "sms_credits_reserve")!;
    expect(reserve.args).toEqual({ p_amount: row.estimated_credits, p_ref_type: SMS_FORM_REF_TYPE, p_ref_id: "msg-1" });
    expect(sendQueuedBatchMock).toHaveBeenCalledWith("tenant-1", ["msg-1"]);
    const settle = db.rpcCalls.find((c) => c.fn === "sms_credits_settle")!;
    expect(settle.args).toEqual({
      p_ref_id: "msg-1",
      p_reserved: row.estimated_credits,
      p_actual: 2,
      p_ref_type: SMS_FORM_REF_TYPE,
    });
  });

  it("not enough credits: marks the message failed, never sends, never settles", async () => {
    const db = fakeDb({ reserve: { data: { ok: false, shortfall: 1 }, error: null } });
    scopedClientForTenantMock.mockResolvedValue(db);

    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });

    expect(out).toEqual({ status: "failed", messageId: "msg-1", reason: "insufficient_credits" });
    expect(db.updates[0]).toMatchObject({ status: "failed", error_code: "insufficient_credits" });
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls.some((c) => c.fn === "sms_credits_settle")).toBe(false);
  });

  it("provider send fails: reports failed and still releases the reservation (actual 0)", async () => {
    const db = fakeDb();
    scopedClientForTenantMock.mockResolvedValue(db);
    sendQueuedBatchMock.mockResolvedValue({ sent: 0, failed: 1, totalCreditsCharged: 0 });

    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });

    expect(out).toMatchObject({ status: "failed", reason: "send_failed" });
    const settle = db.rpcCalls.find((c) => c.fn === "sms_credits_settle")!;
    expect(settle.args.p_actual).toBe(0);
  });

  it("send throws: swallowed (never rejects into the submission) and the reservation is still settled", async () => {
    const db = fakeDb();
    scopedClientForTenantMock.mockResolvedValue(db);
    sendQueuedBatchMock.mockRejectedValue(new Error("provider down"));

    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });

    expect(out).toMatchObject({ status: "failed", reason: "send_failed" });
    expect(db.rpcCalls.some((c) => c.fn === "sms_credits_settle")).toBe(true);
  });

  it("a failure to queue the row is a skip, not a throw, and nothing is reserved", async () => {
    const db = fakeDb({ insertError: { message: "boom" } });
    scopedClientForTenantMock.mockResolvedValue(db);
    const out = await processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false });
    expect(out).toEqual({ status: "skipped", reason: "queue_failed" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("an unexpected error anywhere never rejects", async () => {
    scopedClientForTenantMock.mockRejectedValue(new Error("db unavailable"));
    await expect(processFormSmsAutoresponder(makeForm(), makeLead(), { isResubmission: false })).resolves.toEqual({
      status: "skipped",
      reason: "error",
    });
  });

  it("fire_mode 'every' still sends on a resubmission", async () => {
    const db = fakeDb();
    scopedClientForTenantMock.mockResolvedValue(db);
    const out = await processFormSmsAutoresponder(makeForm({ fire_mode: "every" }), makeLead(), { isResubmission: true });
    expect(out.status).toBe("sent");
  });
});
