import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../index", () => ({ APP_URL: "https://app.test" }));

import { consentSignedEvent, type ConsentSignedAlertPayload } from "./consent-signed";
import type { NotifyDb } from "../types";

const P: ConsentSignedAlertPayload = {
  tenantId: "t1", leadId: "lead-1", consentId: "c1", senderUserId: "u1", signerName: "Aashish Sunuwar", signedAt: "2026-11-06T10:00:00Z",
};

function db(lead: Record<string, unknown> | null, members: string[] = ["u1"], emails: Record<string, string | null> = { u1: "Sender@X.com" }): NotifyDb {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = (_c: string, ids: string[]) => Promise.resolve({ data: ids.filter((i) => members.includes(i)).map((user_id) => ({ user_id, role: "counselor" })), error: null });
  chain.maybeSingle = () => Promise.resolve({ data: lead });
  return {
    from: () => chain,
    auth: { admin: { getUserById: (id: string) => Promise.resolve({ data: { user: emails[id] ? { email: emails[id], user_metadata: {} } : null }, error: null }) } },
  } as unknown as NotifyDb;
}
const tenant = { id: "t1", name: "Admizz", primaryColor: "#000", timezone: "Asia/Kathmandu" };

describe("consentSignedEvent", () => {
  it("emails only the sender (not a role), lower-cased", async () => {
    const r = await consentSignedEvent.recipients!(P, db({ first_name: "A", last_name: "S", email: null }));
    expect(r.map((x) => x.email)).toEqual(["sender@x.com"]);
  });

  it("a sender who is no longer in the tenant gets nothing", async () => {
    expect(await consentSignedEvent.recipients!(P, db({}, []))).toEqual([]);
  });

  it("no sender recorded = nobody to tell: no recipients, not eligible", async () => {
    const p = { ...P, senderUserId: null };
    expect(await consentSignedEvent.recipients!(p, db({}))).toEqual([]);
    expect(await consentSignedEvent.prepare(p, db({ first_name: "A", last_name: "S", email: null }))).toBeNull();
  });

  it("not eligible when the lead can't be found in this tenant", async () => {
    expect(await consentSignedEvent.prepare(P, db(null))).toBeNull();
  });

  it("uses the lead's name, falling back to the typed signer name", async () => {
    expect(await consentSignedEvent.prepare(P, db({ first_name: "Aashish", last_name: "Sunuwar", email: null }))).toEqual({ leadName: "Aashish Sunuwar" });
    expect(await consentSignedEvent.prepare(P, db({ first_name: null, last_name: null, email: null }))).toEqual({ leadName: "Aashish Sunuwar" });
  });

  it("builds a clear subject, link to the lead, and keys the ledger on the consent id", () => {
    const m = consentSignedEvent.build({ payload: P, context: { leadName: "Aashish Sunuwar" }, tenant, recipient: { userId: "u1", email: "s@x.com", name: null } });
    expect(m.subject).toBe("Aashish Sunuwar signed the consent form — Admizz");
    expect(m.html).toContain("https://app.test/leads/lead-1");
    expect(m.text).toContain("Aashish Sunuwar");
    expect(consentSignedEvent.entityId(P)).toBe("c1");
    expect(consentSignedEvent.id).toBe("consent_signed");
  });
});
