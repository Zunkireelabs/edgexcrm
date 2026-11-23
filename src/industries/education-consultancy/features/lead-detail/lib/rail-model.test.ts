import { describe, it, expect } from "vitest";
import { consentRowModel, feeRowModel } from "./rail-model";

const feeIn = (status: Parameters<typeof feeRowModel>[0]["status"], o: Partial<Parameters<typeof feeRowModel>[0]> = {}) =>
  feeRowModel({ status, amount: null, canManageFee: false, canReportFee: false, ...o });

describe("fee row", () => {
  it("not recorded: amber, 'Record' for an admin and for staff who may report", () => {
    expect(feeIn(null, { canManageFee: true })).toMatchObject({ value: "Not recorded", warn: true, action: "record", confirmReject: false });
    expect(feeIn("", { canReportFee: true })).toMatchObject({ value: "Not recorded", warn: true, action: "record" });
  });
  it("not recorded: a viewer who can do neither gets no link", () => {
    expect(feeIn(null)).toMatchObject({ warn: true, action: null });
  });
  it("paid: 'Rs 5,000 · Paid', not amber; only an admin can edit it", () => {
    expect(feeIn("paid", { amount: 5000, canManageFee: true })).toMatchObject({ value: "Rs 5,000 · Paid", warn: false, action: "edit" });
    expect(feeIn("paid", { amount: "5000", canReportFee: true })).toMatchObject({ value: "Rs 5,000 · Paid", action: null });
  });
  it("waiver and unpaid", () => {
    expect(feeIn("waiver", { canManageFee: true })).toMatchObject({ value: "Waiver", warn: false });
    expect(feeIn("unpaid", { canManageFee: true })).toMatchObject({ value: "Unpaid", warn: true, action: "record" });
  });
  it("reported: 'Rs 5,000 reported' in amber; ONLY the admin sees Confirm / Reject, staff can update their report", () => {
    expect(feeIn("claimed", { amount: 5000, canManageFee: true })).toMatchObject({ value: "Rs 5,000 reported", warn: true, confirmReject: true, action: "edit" });
    expect(feeIn("claimed", { amount: 5000, canReportFee: true })).toMatchObject({ value: "Rs 5,000 reported", warn: true, confirmReject: false, action: "edit" });
    expect(feeIn("claimed", { amount: 5000 })).toMatchObject({ confirmReject: false, action: null });
  });
});

const READY = { ready: true, missing: [] as string[] };
const INCOMPLETE = { ready: false, missing: ["Father's name", "Passport no.", "Address"] };
const consentIn = (o: Partial<Parameters<typeof consentRowModel>[0]> = {}) =>
  consentRowModel({ status: "none", readiness: READY, overrideProfile: false, signedAt: null, hasLink: false, hasDocument: false, canManage: true, canOverride: false, ...o });

describe("consent row states", () => {
  it("profile incomplete: 'n fields missing' + 'Complete'; no menu; admins also get 'Send anyway'", () => {
    const staff = consentIn({ readiness: INCOMPLETE });
    expect(staff).toMatchObject({ value: "3 fields missing", warn: true, primary: { kind: "complete", label: "Complete" }, menu: null, sendAnyway: false });
    expect(staff.missing).toEqual(["Father's name", "Passport no.", "Address"]);
    expect(consentIn({ readiness: INCOMPLETE, canOverride: true }).sendAnyway).toBe(true);
    expect(consentIn({ readiness: { ready: false, missing: ["Address"] } }).value).toBe("1 field missing");
  });
  it("after the admin override the incomplete profile no longer blocks: 'Copy link'", () => {
    expect(consentIn({ readiness: INCOMPLETE, overrideProfile: true, canOverride: true })).toMatchObject({ primary: { kind: "copy-link" }, sendAnyway: false, missing: [] });
  });
  it("ready: 'Copy link', with the ··· menu (email, sign in person, upload; no resend before anything was sent)", () => {
    expect(consentIn()).toMatchObject({
      value: "Not sent", warn: true, primary: { kind: "copy-link", label: "Copy link" },
      menu: { email: true, inPerson: true, upload: true, resend: false },
    });
  });
  it("awaiting signature: 'Awaiting signature · Copy', and the menu now offers Resend link", () => {
    expect(consentIn({ status: "sent", hasLink: true })).toMatchObject({
      value: "Awaiting signature", warn: true, primary: { kind: "copy", label: "Copy" }, menu: { email: true, inPerson: true, upload: true, resend: true },
    });
    expect(consentIn({ status: "sent", hasLink: false }).primary).toBeNull(); // nothing to copy
  });
  it("expired: 'Link expired · Resend'", () => {
    expect(consentIn({ status: "expired" })).toMatchObject({ value: "Link expired", warn: true, primary: { kind: "resend", label: "Resend" } });
  });
  it("signed: 'Signed Nov 10 · View', not amber, no menu", () => {
    const d = new Date(2026, 10, 10, 12).toISOString();
    expect(consentIn({ status: "signed", signedAt: d, hasDocument: true })).toMatchObject({ value: "Signed Nov 10", warn: false, primary: { kind: "view", label: "View" }, menu: null });
    expect(consentIn({ status: "signed", signedAt: d, hasDocument: false }).primary).toBeNull();
  });
  it("a viewer who may not manage consent sees the state and no actions", () => {
    expect(consentIn({ canManage: false })).toMatchObject({ value: "Not sent", primary: null, menu: null, sendAnyway: false });
    expect(consentIn({ canManage: false, status: "sent" })).toMatchObject({ value: "Awaiting signature", primary: null, menu: null });
  });
});
