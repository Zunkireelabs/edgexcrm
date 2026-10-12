// When is the Pre Application card "all done"?
//
// Client request: the green "Consent signed" signal must show only when BOTH the Processing Fee and the
// Student Consent are complete. A signed consent with the fee still "Not set" must not look finished.
//
// "Fee complete" = Paid or Waiver. Unpaid and Not set are still pending.

export type ConsentState = "none" | "sent" | "signed" | "expired";

const FEE_COMPLETE = new Set(["paid", "waiver"]);

export function isFeeComplete(feeStatus: string | null | undefined): boolean {
  return FEE_COMPLETE.has((feeStatus ?? "").toLowerCase());
}

export interface Completeness {
  /** Green only when everything this card tracks is done. */
  complete: boolean;
  consentSigned: boolean;
  /** False when the fee is pending. Always true on cards that don't show a fee section. */
  feeDone: boolean;
}

export function cardCompleteness(input: {
  consent: ConsentState;
  /** The SAVED fee status — an unsaved dropdown choice must not turn the card green. */
  savedFeeStatus: string | null | undefined;
  showProcessingFee: boolean;
}): Completeness {
  const consentSigned = input.consent === "signed";
  const feeDone = !input.showProcessingFee || isFeeComplete(input.savedFeeStatus);
  return { complete: consentSigned && feeDone, consentSigned, feeDone };
}
