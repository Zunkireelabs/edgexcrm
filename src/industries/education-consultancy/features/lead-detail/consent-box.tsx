"use client";

import { CheckCircleIcon, CircleNotchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { LeadFile } from "./lead-file";
import { consentRowModel, feeRowModel } from "./lib/rail-model";

const KV = "flex min-h-8 items-center gap-2 rounded-[8px] px-2 text-[13px]";
const KEY = "w-[100px] flex-none whitespace-nowrap text-black/[.63]";
const VAL = "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap";
const DONE = <CheckCircleIcon aria-label="Done" className="ml-auto size-4 flex-none text-[#12805c]" />;

/**
 * The rail's Consent & fee box: information only (client request, Nov 2026). Two 32px rows, key width 100, value amber while
 * it is missing, a green tick once it is done. Every action (record / edit the fee, send / copy / view consent) lives in the
 * Consent & fee tab and the stage card, which use the same `useFee` / `useConsent` as this box reads.
 */
export function ConsentBox({ file }: { file: LeadFile }) {
  const { fee, consent } = file;
  const feeRow = feeRowModel({ status: fee.feeStatus || null, amount: fee.feeAmount, canManageFee: false, canReportFee: false });
  const record = consent.status?.record ?? null;
  const row = consentRowModel({
    status: consent.consentStatus, readiness: consent.readiness, overrideProfile: consent.overrideProfile, signedAt: record?.signed_at ?? null,
    hasLink: false, hasDocument: false, canManage: false, canOverride: false,
  });
  if (consent.loading) {
    return <div className="flex h-[68px] items-center justify-center rounded-[12px] shadow-[inset_0_0_0_1px_#eeeff1]"><CircleNotchIcon className="size-4 animate-spin text-black/40" /></div>;
  }
  const feeDone = fee.feeStatus === "paid" || fee.feeStatus === "waiver";
  const consentDone = consent.consentStatus === "signed";

  return (
    <div className="rounded-[12px] p-0.5 shadow-[inset_0_0_0_1px_#eeeff1]" data-testid="consent-box">
      <div className={KV} data-testid="fee-row">
        <span className={KEY}>Processing fee</span>
        <span className={cn(VAL, feeRow.warn && "text-[#b25e09]")}>{feeRow.value}</span>
        {feeDone && DONE}
      </div>
      <div className={KV} data-testid="consent-row">
        <span className={KEY}>Consent</span>
        <span className={cn(VAL, row.warn && "text-[#b25e09]")}>{row.value}</span>
        {consentDone && DONE}
      </div>
      {row.missing.length > 0 && (
        <p className="m-0 px-2 pb-1.5 text-[12px] leading-4 text-black/[.63]" data-testid="consent-missing">
          Missing for consent: {row.missing.slice(0, 3).join(", ")}{row.missing.length > 3 ? ` +${row.missing.length - 3}` : ""}
        </p>
      )}
    </div>
  );
}
