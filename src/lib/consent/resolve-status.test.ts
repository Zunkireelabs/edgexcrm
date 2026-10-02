import { describe, expect, it } from "vitest";
import { resolveConsentStatus, type ConsentRecordRow } from "./resolve-status";

const NOW = new Date("2026-09-29T12:00:00Z");

function row(over: Partial<ConsentRecordRow> & { id: string; status: string }): ConsentRecordRow {
  return {
    method: null,
    token: null,
    signer_name: null,
    signed_at: null,
    document_url: null,
    link_expires_at: null,
    sent_at: null,
    sent_via: null,
    ...over,
  };
}

const signedRow = (id = "signed-1") => row({ id, status: "signed", method: "link", signer_name: "Student", signed_at: "2026-09-20T10:00:00Z" });
const sentRow = (id = "sent-1", expires = "2026-10-05T00:00:00Z") => row({ id, status: "sent", token: "tok", link_expires_at: expires });

describe("resolveConsentStatus", () => {
  it("is none when the lead has no consent records", () => {
    expect(resolveConsentStatus([], NOW)).toEqual({ status: "none", record: null });
  });

  it("is signed when the only record is signed", () => {
    const s = signedRow();
    expect(resolveConsentStatus([s], NOW)).toEqual({ status: "signed", record: s });
  });

  it("stays signed when a NEWER 'sent' row exists next to the signed one (the production bug)", () => {
    const s = signedRow();
    const result = resolveConsentStatus([sentRow("sent-newer"), s], NOW);
    expect(result.status).toBe("signed");
    expect(result.record?.id).toBe("signed-1");
  });

  it("stays signed when the newer unsigned row has an expired link", () => {
    const s = signedRow();
    const result = resolveConsentStatus([sentRow("sent-old-link", "2026-09-01T00:00:00Z"), s], NOW);
    expect(result.status).toBe("signed");
  });

  it("uses the newest signed record's details when several are signed", () => {
    const newer = signedRow("signed-newer");
    const older = signedRow("signed-older");
    expect(resolveConsentStatus([newer, older], NOW).record?.id).toBe("signed-newer");
  });

  it("is sent while the link is still valid and nothing is signed", () => {
    const r = sentRow();
    expect(resolveConsentStatus([r], NOW)).toEqual({ status: "sent", record: r });
  });

  it("is expired when the newest sent link is past its expiry and nothing is signed", () => {
    const r = sentRow("sent-1", "2026-09-28T00:00:00Z");
    expect(resolveConsentStatus([r], NOW)).toEqual({ status: "expired", record: r });
  });

  it("treats a sent row with no expiry as still sent", () => {
    const r = row({ id: "s", status: "sent", token: "tok", link_expires_at: null });
    expect(resolveConsentStatus([r], NOW).status).toBe("sent");
  });

  it("keeps the old behaviour for an unknown status on the newest row: none, record still returned", () => {
    const r = row({ id: "x", status: "declined" });
    expect(resolveConsentStatus([r], NOW)).toEqual({ status: "none", record: r });
  });
});
