"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

export type FeeStatus = "paid" | "unpaid" | "waiver" | "claimed";

export interface FeeInit {
  status?: FeeStatus | null;
  amount?: number | null;
  notes?: string | null;
}

export interface FeeValues {
  status: FeeStatus | "";
  amount: string;
  notes: string;
}

export interface UseFeeOptions {
  leadId: string;
  init: FeeInit;
  /** Owner/admin records the fee; anyone else can only REPORT it ("claimed"). */
  canManageFee: boolean;
  /** May report a fee (assignee / branch manager etc.). */
  canManage: boolean;
  /** Called after a successful save with the lead columns that changed, so the page can update its copy of the lead. */
  onSaved?: (patch: { pre_app_fee_status: FeeStatus | null; pre_app_fee_amount: number | null; pre_app_fee_notes: string | null }) => void;
}

/**
 * The Pre-Application processing fee (migration 084), extracted from ConsentCard so every surface that edits it
 * (the Consent & fee tab, the rail box, the stage card's "Record" link) shares ONE state and ONE save.
 * `saveFee` is ConsentCard's logic unchanged: same PATCH body, same toasts. The fee-claimed notification is raised by
 * the server on that PATCH, so it fires from every surface.
 */
export function useFee({ leadId, init, canManageFee, canManage, onSaved }: UseFeeOptions) {
  const [feeStatus, setFeeStatus] = useState<FeeStatus | "">(init.status ?? "");
  const [feeAmount, setFeeAmount] = useState(init.amount !== null && init.amount !== undefined ? String(init.amount) : "");
  const [feeNotes, setFeeNotes] = useState(init.notes ?? "");
  // The fee as last SAVED. The green "complete" signal reads this, never an unsaved choice.
  const [savedFeeStatus, setSavedFeeStatus] = useState<string>(init.status ?? "");
  const [feeDirty, setFeeDirty] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);

  const feeIsReported = savedFeeStatus === "claimed";
  const canReportFee = canManage && !canManageFee && (savedFeeStatus === "" || feeIsReported);

  /**
   * `override` = admin Confirm ("paid") / Reject ("unpaid") on a reported fee. `values` = what a popover collected
   * (so the save never reads a stale closure); without it the hook's own fields are saved.
   */
  const saveFee = useCallback(
    async (override?: FeeStatus, values?: Partial<FeeValues>): Promise<boolean> => {
      const status = values?.status !== undefined ? values.status : feeStatus;
      const amount = values?.amount !== undefined ? values.amount : feeAmount;
      const notes = values?.notes !== undefined ? values.notes : feeNotes;
      setFeeSaving(true);
      const statusToSave: FeeStatus | "" = override ?? (canManageFee ? status : "claimed");
      const amountToSave = (statusToSave === "paid" || statusToSave === "claimed") && amount !== "" ? Number(amount) : null;
      try {
        const res = await fetch(`/api/v1/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pre_app_fee_status: statusToSave || null,
            pre_app_fee_amount: amountToSave,
            pre_app_fee_notes: notes.trim() || null,
          }),
        });
        if (!res.ok) throw new Error();
        toast.success(
          override === "paid" ? "Fee confirmed" : override === "unpaid" ? "Fee report rejected"
            : canManageFee ? "Processing fee saved" : "Fee reported — the Account will verify it",
        );
        setFeeStatus(statusToSave);
        setFeeAmount(amount);
        setFeeNotes(notes);
        setSavedFeeStatus(statusToSave);
        setFeeDirty(false);
        onSaved?.({ pre_app_fee_status: statusToSave || null, pre_app_fee_amount: amountToSave, pre_app_fee_notes: notes.trim() || null });
        return true;
      } catch {
        toast.error("Failed to save application fee");
        return false;
      } finally {
        setFeeSaving(false);
      }
    },
    [leadId, feeStatus, feeAmount, feeNotes, canManageFee, onSaved],
  );

  return {
    feeStatus, feeAmount, feeNotes, savedFeeStatus, feeDirty, feeSaving, feeIsReported, canReportFee, canManageFee, canManage,
    setFeeStatus: (v: FeeStatus | "") => { setFeeStatus(v); setFeeDirty(true); },
    setFeeAmount: (v: string) => { setFeeAmount(v); setFeeDirty(true); },
    setFeeNotes: (v: string) => { setFeeNotes(v); setFeeDirty(true); },
    saveFee,
  };
}

export type FeeApi = ReturnType<typeof useFee>;

/** "Rs 5,000" — the amount the rail shows; null when there is none. */
export function formatRs(amount: string | number | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `Rs ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
