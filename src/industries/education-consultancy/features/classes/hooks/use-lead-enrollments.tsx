"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AddEnrollmentDialog } from "../components/add-enrollment-dialog";

export interface Enrollment {
  id: string;
  class_id: string;
  fee_paid: boolean;
  fee_amount: number | null;
  enrollment_type: "demo" | "actual";
  status: "active" | "inactive" | "completed";
  created_at: string;
  classes?: {
    id: string;
    name: string;
    default_fee: number | null;
  } | null;
}

/**
 * One lead's class enrollments, plus the "Add to class" dialog. The lead page's Classes tab and its right-rail section
 * both read THIS state (EDGEX-154), so an enrollment added or changed in one shows in the other. A standalone
 * ClassesCard (the legacy lead page) calls it itself.
 */
export function useLeadEnrollments(leadId: string, opts: { enabled?: boolean; leadName?: string } = {}) {
  const { enabled = true, leadName } = opts;
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const fetchEnrollments = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/classes`);
      if (!res.ok) throw new Error(`Failed to fetch classes (${res.status})`);
      const { data } = await res.json();
      setEnrollments(data ?? []);
      setLoadError(false);
    } catch {
      // A failed fetch must never look identical to a genuine empty list —
      // this exact confusion (404 rendering as "Not enrolled in any class
      // yet.") was a real prod bug that hid a collaborator-visibility
      // permissions gap for weeks. Surface it distinctly instead.
      setEnrollments([]);
      setLoadError(true);
      toast.error("Couldn't load this student's classes — try refreshing the page.");
    }
  }, [leadId]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetchEnrollments().finally(() => setLoading(false));
  }, [fetchEnrollments, enabled]);

  const dialogs = (
    <AddEnrollmentDialog open={addOpen} onOpenChange={setAddOpen} leadId={leadId} leadName={leadName} onSaved={() => { void fetchEnrollments(); }} />
  );

  return { enrollments, loading, loadError, fetchEnrollments, openAdd: () => setAddOpen(true), dialogs };
}

export type EnrollmentsApi = ReturnType<typeof useLeadEnrollments>;
