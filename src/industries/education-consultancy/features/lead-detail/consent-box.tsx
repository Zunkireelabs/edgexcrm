"use client";

import { DotsThreeIcon, CircleNotchIcon } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { LeadFile } from "./lead-file";
import { FeePopover } from "./fee-popover";
import { consentRowModel, feeRowModel } from "./lib/rail-model";

const KV = "flex min-h-8 items-center gap-2 rounded-[8px] px-2 text-[13px]";
const KEY = "w-[100px] flex-none whitespace-nowrap text-black/[.63]";
const VAL = "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap";
const LINK = "flex-none rounded-[4px] text-[13px] text-[#266df0] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:opacity-50";

/**
 * The rail's Consent & fee box: two 32px rows, key width 100, value amber while it is missing. Every action goes
 * through the page's single `useFee` / `useConsent` (the stage card's "Record" and "Copy link" call the same ones).
 */
export function ConsentBox({ file, canManage, isAdmin, onEditProfile }: { file: LeadFile; canManage: boolean; isAdmin: boolean; onEditProfile: () => void }) {
  const { fee, consent } = file;
  const feeRow = feeRowModel({ status: fee.feeStatus || null, amount: fee.feeAmount, canManageFee: fee.canManageFee, canReportFee: fee.canReportFee });
  const record = consent.status?.record ?? null;
  const row = consentRowModel({
    status: consent.consentStatus, readiness: consent.readiness, overrideProfile: consent.overrideProfile, signedAt: record?.signed_at ?? null,
    hasLink: !!consent.status?.link, hasDocument: !!record?.document_url, canManage, canOverride: isAdmin,
  });
  if (consent.loading) {
    return <div className="flex h-[68px] items-center justify-center rounded-[12px] shadow-[inset_0_0_0_1px_#eeeff1]"><CircleNotchIcon className="size-4 animate-spin text-black/40" /></div>;
  }

  const onPrimary = () => {
    switch (row.primary?.kind) {
      case "complete": return onEditProfile();
      case "copy-link": return void consent.handleCreateAndCopyLink();
      case "copy": return void consent.handleCopyLink();
      case "resend": return void consent.handleResend();
      case "view": return consent.openPreview();
    }
  };

  return (
    <div className="rounded-[12px] p-0.5 shadow-[inset_0_0_0_1px_#eeeff1]" data-testid="consent-box">
      <div className={KV} data-testid="fee-row">
        <span className={KEY}>Processing fee</span>
        <span className={cn(VAL, feeRow.warn && "text-[#b25e09]")}>{feeRow.value}</span>
        {feeRow.action && (
          <FeePopover fee={fee}>
            <button type="button" className={LINK}>{feeRow.action === "record" ? "Record" : "Edit"}</button>
          </FeePopover>
        )}
      </div>
      {feeRow.confirmReject && (
        <div className="flex gap-1.5 px-2 pb-1.5" data-testid="fee-confirm-reject">
          <button type="button" disabled={fee.feeSaving} onClick={() => void fee.saveFee("paid")} className="inline-flex h-[26px] items-center rounded-[8px] bg-white px-2 text-[13px] font-medium text-[#101112] shadow-[inset_0_0_0_1px_#e8e9eb] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:opacity-50">Confirm</button>
          <button type="button" disabled={fee.feeSaving} onClick={() => void fee.saveFee("unpaid")} className="inline-flex h-[26px] items-center rounded-[8px] px-2 text-[13px] font-medium text-black/[.63] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:opacity-50">Reject</button>
        </div>
      )}

      <div className={KV} data-testid="consent-row">
        <span className={KEY}>Consent</span>
        <span className={cn(VAL, row.warn && "text-[#b25e09]")}>{row.value}</span>
        {row.primary && (
          <button type="button" onClick={onPrimary} disabled={consent.creatingLink} className={LINK}>
            {consent.creatingLink && row.primary.kind === "copy-link" ? "Copying…" : row.primary.label}
          </button>
        )}
        {row.menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More ways to get consent signed" className="inline-flex size-6 flex-none items-center justify-center rounded-[6px] text-black/50 outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">
                <DotsThreeIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              {row.menu.email && <DropdownMenuItem onSelect={() => consent.openSendDialog()}>Email it to the student</DropdownMenuItem>}
              {row.menu.inPerson && <DropdownMenuItem onSelect={() => consent.openInPerson()}>Sign in person (on this device)</DropdownMenuItem>}
              {row.menu.upload && <DropdownMenuItem onSelect={() => consent.openManualDialog()}>Upload a signed copy</DropdownMenuItem>}
              {row.menu.resend && <DropdownMenuItem onSelect={() => void consent.handleResend()}>Resend link</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {row.missing.length > 0 && (
        <p className="m-0 px-2 pb-1.5 text-[12px] leading-4 text-black/[.63]" data-testid="consent-missing">
          Missing for consent: {row.missing.slice(0, 3).join(", ")}{row.missing.length > 3 ? ` +${row.missing.length - 3}` : ""}
        </p>
      )}
      {row.sendAnyway && (
        <div className="px-2 pb-1.5">
          <button type="button" onClick={() => consent.askOverride()} className="inline-flex h-6 items-center rounded-[6px] px-1.5 text-[12px] font-medium text-black/[.63] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">Admins: Send anyway</button>
        </div>
      )}
    </div>
  );
}
