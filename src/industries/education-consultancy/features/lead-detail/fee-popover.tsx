"use client";

import { useState, type ReactNode } from "react";
import { CircleNotchIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatRs, type FeeApi, type FeeStatus } from "../application-tracking/hooks/use-fee";

const FIELD = "h-8 w-full rounded-[9px] bg-white px-2.5 text-[13px] text-[#101112] shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)] outline-none placeholder:text-black/40 focus:shadow-[inset_0_0_0_1px_#266df0]";
const LABEL = "mb-1 block text-[12px] font-medium leading-4 text-black/[.63]";
const GHOST = "inline-flex h-7 items-center rounded-[8px] px-2.5 text-[13px] font-medium text-black/[.63] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50";
const PRIMARY = "inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-[#266df0] px-3 text-[13px] font-medium text-white outline-none hover:bg-[#1d5bd0] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The processing-fee popover (300px). Admin: Paid / Unpaid / Waiver + amount + note → Save. Staff: they REPORT the fee,
 * an admin confirms it, and a report already counts for the Applications check. Both go through the page's one `useFee`,
 * so it is the same save (and the same fee-claimed notification) wherever it is opened from.
 * There is deliberately no "Received" date: it needs a new column (EDGEX-157).
 */
export function FeePopover({ fee, children }: { fee: FeeApi; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FeeStatus | "">("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const admin = fee.canManageFee;
  const adminStatus = (v: string): FeeStatus | "" => (v === "paid" || v === "unpaid" || v === "waiver" ? v : "");

  const onOpenChange = (next: boolean) => {
    if (next) { setStatus(adminStatus(fee.feeStatus)); setAmount(fee.feeAmount); setNotes(fee.feeNotes); }
    setOpen(next);
  };

  const amountOk = amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;
  const canSave = admin ? status !== "" && (status !== "paid" || amount === "" || amountOk) : amountOk;

  const save = async () => {
    const ok = await fee.saveFee(undefined, { status, amount: admin && status !== "paid" ? "" : amount, notes });
    if (ok) setOpen(false);
  };
  const decide = async (override: "paid" | "unpaid") => { if (await fee.saveFee(override)) setOpen(false); };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-0" aria-label={admin ? "Processing fee" : "Report fee"}>
        <form onSubmit={(e) => { e.preventDefault(); if (canSave && !fee.feeSaving) void save(); }} className="space-y-3 p-3">
          {admin ? (
            <>
              {fee.feeIsReported && (
                <div className="rounded-[8px] bg-[#fff3e0] px-2.5 py-2 text-[13px] leading-[18px] text-[#b25e09]" data-testid="fee-reported-note">
                  {formatRs(fee.feeAmount) ?? "A fee"} reported by staff.
                  <span className="mt-1.5 flex gap-1.5">
                    <button type="button" disabled={fee.feeSaving} onClick={() => void decide("paid")} className={PRIMARY}>Confirm</button>
                    <button type="button" disabled={fee.feeSaving} onClick={() => void decide("unpaid")} className={GHOST}>Reject</button>
                  </span>
                </div>
              )}
              <div>
                <span className={LABEL} id="fee-status-label">Fee status</span>
                <SegmentedControl
                  aria-label="Fee status" value={status} onValueChange={(v) => setStatus(adminStatus(v))}
                  items={[{ value: "paid", label: "Paid" }, { value: "unpaid", label: "Unpaid" }, { value: "waiver", label: "Waiver" }]}
                />
              </div>
              {status === "paid" && (
                <div>
                  <label htmlFor="fee-amount" className={LABEL}>Amount (Rs)</label>
                  <input id="fee-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={FIELD} />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="m-0 text-[13px] leading-[18px] text-black/[.63]">You report the fee; an admin confirms it. Reported counts for the Applications check.</p>
              <div>
                <label htmlFor="fee-amount" className={LABEL}>Amount received (Rs)</label>
                <input id="fee-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={FIELD} autoFocus />
              </div>
            </>
          )}
          <div>
            <label htmlFor="fee-note" className={LABEL}>Note <span className="font-normal text-black/40">(optional)</span></label>
            <input id="fee-note" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={admin ? "e.g. Cash at Kathmandu desk" : "e.g. Receipt no., paid by father"} className={FIELD} />
          </div>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setOpen(false)} className={GHOST}>Cancel</button>
            <button type="submit" disabled={!canSave || fee.feeSaving} className={PRIMARY}>
              {fee.feeSaving && <CircleNotchIcon className="size-3.5 animate-spin" />}
              {admin ? "Save" : fee.feeIsReported ? "Update report" : "Report fee"}
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
