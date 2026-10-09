import { describe, expect, it } from "vitest";
import { cardCompleteness, isFeeComplete } from "./consent-completeness";

describe("isFeeComplete", () => {
  it("counts Paid and Waiver as complete", () => {
    expect(isFeeComplete("paid")).toBe(true);
    expect(isFeeComplete("waiver")).toBe(true);
    expect(isFeeComplete("PAID")).toBe(true);
  });

  it("keeps Unpaid and Not set pending", () => {
    expect(isFeeComplete("unpaid")).toBe(false);
    expect(isFeeComplete("")).toBe(false);
    expect(isFeeComplete(null)).toBe(false);
    expect(isFeeComplete(undefined)).toBe(false);
  });
});

describe("cardCompleteness — green only when BOTH are done", () => {
  const base = { showProcessingFee: true };

  it("is complete only when consent is signed AND the fee is Paid or Waiver", () => {
    expect(cardCompleteness({ ...base, consent: "signed", savedFeeStatus: "paid" }).complete).toBe(true);
    expect(cardCompleteness({ ...base, consent: "signed", savedFeeStatus: "waiver" }).complete).toBe(true);
  });

  it("is NOT complete when consent is signed but the fee is pending", () => {
    for (const fee of ["", null, "unpaid"]) {
      const r = cardCompleteness({ ...base, consent: "signed", savedFeeStatus: fee });
      expect(r.complete, String(fee)).toBe(false);
      expect(r.consentSigned).toBe(true);
      expect(r.feeDone).toBe(false);
    }
  });

  it("is NOT complete when the fee is done but consent is not signed", () => {
    for (const consent of ["none", "sent", "expired"] as const) {
      const r = cardCompleteness({ ...base, consent, savedFeeStatus: "paid" });
      expect(r.complete, consent).toBe(false);
      expect(r.feeDone).toBe(true);
    }
  });

  it("is NOT complete when neither is done", () => {
    expect(cardCompleteness({ ...base, consent: "none", savedFeeStatus: "" }).complete).toBe(false);
  });

  it("depends on consent alone when the card has no fee section", () => {
    expect(cardCompleteness({ showProcessingFee: false, consent: "signed", savedFeeStatus: "" }).complete).toBe(true);
    expect(cardCompleteness({ showProcessingFee: false, consent: "none", savedFeeStatus: "paid" }).complete).toBe(false);
  });
});
