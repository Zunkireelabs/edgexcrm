import { shortDate } from "../../record-preview/lib/readiness";
import { formatRs, type FeeStatus } from "../../application-tracking/hooks/use-fee";
import type { ConsentStatus } from "../../application-tracking/hooks/use-consent";

/** What the "Processing fee" row of the rail's Consent & fee box says and offers. Pure, so the states are unit tested. */
export interface FeeRowModel {
  value: string;
  /** Amber: the fee still stands between this lead and Applications (missing / unpaid) or awaits an admin. */
  warn: boolean;
  /** "Record" opens the popover on a fee that isn't recorded; "Edit" on one that is. Null = the viewer can't change it. */
  action: "record" | "edit" | null;
  /** Admin viewing a reported fee: Confirm / Reject buttons under the row. */
  confirmReject: boolean;
}

export function feeRowModel(input: { status: FeeStatus | "" | null; amount: string | number | null; canManageFee: boolean; canReportFee: boolean }): FeeRowModel {
  const { canManageFee, canReportFee } = input;
  const status = input.status || "";
  const rs = formatRs(input.amount);
  switch (status) {
    case "paid": return { value: rs ? `${rs} · Paid` : "Paid", warn: false, action: canManageFee ? "edit" : null, confirmReject: false };
    case "waiver": return { value: "Waiver", warn: false, action: canManageFee ? "edit" : null, confirmReject: false };
    case "claimed": return { value: rs ? `${rs} reported` : "Reported", warn: true, action: canManageFee || canReportFee ? "edit" : null, confirmReject: canManageFee };
    case "unpaid": return { value: "Unpaid", warn: true, action: canManageFee ? "record" : null, confirmReject: false };
    default: return { value: "Not recorded", warn: true, action: canManageFee || canReportFee ? "record" : null, confirmReject: false };
  }
}

export type ConsentPrimary =
  | { kind: "complete"; label: "Complete" }
  | { kind: "copy-link"; label: "Copy link" }
  | { kind: "copy"; label: "Copy" }
  | { kind: "resend"; label: "Resend" }
  | { kind: "view"; label: "View" };

export interface ConsentRowModel {
  value: string;
  warn: boolean;
  primary: ConsentPrimary | null;
  /** The ··· menu (Email it, Sign in person, Upload a signed copy, Resend link). */
  menu: { email: boolean; inPerson: boolean; upload: boolean; resend: boolean } | null;
  /** Admins only: "Send anyway" while the profile is incomplete. */
  sendAnyway: boolean;
  /** Profile incomplete: what is missing, for the one-line note under the row. */
  missing: string[];
}

export function consentRowModel(input: {
  status: ConsentStatus["status"];
  readiness: ConsentStatus["readiness"];
  overrideProfile: boolean;
  signedAt: string | null;
  hasLink: boolean;
  hasDocument: boolean;
  canManage: boolean;
  canOverride: boolean;
}): ConsentRowModel {
  const { status, readiness, canManage } = input;
  const incomplete = status === "none" && !!readiness && !readiness.ready && !input.overrideProfile;
  const missing = incomplete && readiness ? readiness.missing : [];
  const menuAll = { email: true, inPerson: true, upload: true };

  if (status === "signed") {
    return {
      value: input.signedAt ? `Signed ${shortDate(input.signedAt, "md")}` : "Signed", warn: false,
      primary: input.hasDocument ? { kind: "view", label: "View" } : null, menu: null, sendAnyway: false, missing: [],
    };
  }
  if (!canManage) {
    // Read-only viewer: the state, no actions.
    return {
      value: status === "sent" ? "Awaiting signature" : status === "expired" ? "Link expired" : incomplete ? `${missing.length} fields missing` : "Not sent",
      warn: true, primary: null, menu: null, sendAnyway: false, missing,
    };
  }
  if (status === "expired") {
    return { value: "Link expired", warn: true, primary: { kind: "resend", label: "Resend" }, menu: { ...menuAll, resend: false }, sendAnyway: false, missing: [] };
  }
  if (status === "sent") {
    return {
      value: "Awaiting signature", warn: true, primary: input.hasLink ? { kind: "copy", label: "Copy" } : null,
      menu: { ...menuAll, resend: true }, sendAnyway: false, missing: [],
    };
  }
  if (incomplete) {
    return {
      value: `${missing.length} field${missing.length === 1 ? "" : "s"} missing`, warn: true,
      primary: { kind: "complete", label: "Complete" }, menu: null, sendAnyway: input.canOverride, missing,
    };
  }
  return { value: "Not sent", warn: true, primary: { kind: "copy-link", label: "Copy link" }, menu: { ...menuAll, resend: false }, sendAnyway: false, missing: [] };
}
