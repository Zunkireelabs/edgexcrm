"use client";

import { useCallback, useEffect, useState } from "react";
import { useBlockingNotice } from "@/components/dashboard/blocking-notice";
import { profileIncompleteNotice } from "@/lib/blocking-notice";
import type { Application, ApplicationStage } from "@/types/database";
import { AddApplicationDialog } from "../components/add-application-dialog";

/**
 * One lead's applications + the "Add application" flow. The lead page's Applications tab and its right-rail section
 * both read THIS state (EDGEX-154); a standalone ApplicationsCard (legacy page) calls it itself.
 *
 * `locked` = the tenant has an active consent template and it isn't signed yet: the "+" stays clickable so it can say
 * WHY (a dead button explains nothing), but opens the "complete the consent form first" notice instead of the form.
 */
export function useLeadApplications(leadId: string, opts: { enabled?: boolean; locked?: boolean; leadName?: string } = {}) {
  const { enabled = true, locked = false, leadName } = opts;
  const [applications, setApplications] = useState<Application[]>([]);
  const [stages, setStages] = useState<ApplicationStage[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [addOpen, setAddOpen] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const { notify, showNotice, noticeDialog } = useBlockingNotice();

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/applications`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setApplications(data ?? []);
    } catch {
      // silently fail — the list stays empty
    }
  }, [leadId]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    Promise.all([
      fetchApplications(),
      fetch("/api/v1/application-stages").then((r) => r.json()).then((j) => setStages(j.data ?? [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [fetchApplications, enabled]);

  // Check the student's profile BEFORE opening the form, so a missing item is shown up front in a big
  // pop-up instead of as a small message after the whole form is filled. If the check can't run we
  // open the form anyway — the create API still enforces the rule when saving.
  async function requestAdd() {
    if (checkingProfile) return;
    if (locked) {
      notify({ code: "CONSENT_REQUIRED" });
      return;
    }
    setCheckingProfile(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/profile-completeness`);
      if (res.ok) {
        const { data } = await res.json();
        if (data && data.complete === false) {
          showNotice(profileIncompleteNotice(data.missing ?? []));
          return;
        }
      }
      setAddOpen(true);
    } catch {
      setAddOpen(true);
    } finally {
      setCheckingProfile(false);
    }
  }

  const dialogs = (
    <>
      <AddApplicationDialog
        open={addOpen} onOpenChange={setAddOpen} leadId={leadId} stages={stages} leadName={leadName}
        onSaved={() => { void fetchApplications(); }}
      />
      {noticeDialog}
    </>
  );

  return { applications, setApplications, stages, loading, locked, checkingProfile, fetchApplications, requestAdd, dialogs };
}

export type ApplicationsApi = ReturnType<typeof useLeadApplications>;
