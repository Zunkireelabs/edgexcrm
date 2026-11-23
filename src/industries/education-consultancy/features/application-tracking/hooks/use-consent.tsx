"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBlockingNotice } from "@/components/dashboard/blocking-notice";
import { SendConsentDialog } from "../components/send-consent-dialog";
import { InPersonConsentDialog } from "../components/in-person-consent-dialog";

/** Missing fields grouped by the Student Details section they live in (`section` "" = ungrouped fallback). */
export interface MissingGroupView {
  section: string;
  fields: string[];
}

export interface ConsentStatus {
  consent_enabled: boolean;
  status: "none" | "sent" | "signed" | "expired";
  record: {
    id: string;
    signer_name: string | null;
    signed_at: string | null;
    document_url: string | null;
    token: string | null;
    method: string | null;
    sent_via: string | null;
  } | null;
  link: string | null;
  /** Education only: is the profile complete enough to generate a consent document? null/absent = no gate. */
  readiness?: { ready: boolean; missing: string[]; groups?: MissingGroupView[] } | null;
}

export interface UseConsentOptions {
  leadId: string;
  tenantId: string;
  /** Changes whenever the student's profile fields change, so the status re-checks whether consent is allowed. */
  profileKey?: string;
  /** When false the hook stays idle (no fetch) — a tenant without an active consent template. */
  enabled?: boolean;
  onSignedChange?: (signed: boolean) => void;
  /** Education: the send dialog offers "copy only". */
  allowCopyOnly?: boolean;
}

/**
 * The consent flow (status, copy link, resend, send / sign-in-person / upload dialogs, the admin "send anyway"
 * override), extracted from ConsentCard so the Consent & fee tab, the rail row and the stage card's "Copy link" all
 * call the SAME handlers on the SAME state. Behaviour is ConsentCard's, unchanged.
 */
export function useConsent({ leadId, tenantId, profileKey, enabled = true, onSignedChange, allowCopyOnly = true }: UseConsentOptions) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"send" | "manual">("send");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inPersonOpen, setInPersonOpen] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  // Owner/admin chose "Send anyway" for an incomplete profile (after confirming). Resets on reload.
  const [overrideProfile, setOverrideProfile] = useState(false);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
  const overrideBody = overrideProfile ? { override_profile_check: true } : {};
  const { notify, noticeDialog } = useBlockingNotice();
  const onSignedRef = useRef(onSignedChange);
  useEffect(() => { onSignedRef.current = onSignedChange; });

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/consent`);
      if (!res.ok) return;
      const { data } = await res.json();
      setStatus(data as ConsentStatus);
      onSignedRef.current?.((data as ConsentStatus).status === "signed");
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [leadId, enabled]);

  // profileKey changes when the student's details are edited, so the "complete the profile" gate updates live.
  useEffect(() => { void fetchStatus(); }, [fetchStatus, profileKey]);

  function openDialog(tab: "send" | "manual") {
    setDialogTab(tab);
    setDialogOpen(true);
  }

  // One click: create the signing link WITHOUT emailing the student, copy it, and let the status move on to
  // "Awaiting signature" (which keeps its own Copy link action if the clipboard is unavailable).
  async function handleCreateAndCopyLink() {
    setCreatingLink(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", deliver: "none", ...overrideBody }),
      });
      const json = await res.json();
      if (!res.ok) {
        notify(json.error, "Failed to create consent link");
        if (json.error?.code === "ALREADY_SIGNED") void fetchStatus();
        return;
      }
      const link = (json.data as { link?: string }).link;
      try {
        if (!link) throw new Error("no link");
        await navigator.clipboard.writeText(link);
        toast.success("Consent link copied");
      } catch {
        // Some browsers refuse clipboard writes after a network round-trip; the link exists either way.
        toast.info("Link created — use Copy link");
      }
      void fetchStatus();
    } catch {
      toast.error("Failed to create consent link");
    } finally {
      setCreatingLink(false);
    }
  }

  async function handleCopyLink() {
    if (!status?.link) return;
    try {
      await navigator.clipboard.writeText(status.link);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  }

  async function handleResend() {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", ...overrideBody }),
      });
      if (!res.ok) {
        const json = await res.json();
        notify(json.error, "Failed to resend consent");
        // The student signed while this still showed "awaiting signature": re-read the status so the card
        // (and the Applications "+") correct themselves instead of staying stale.
        if (json.error?.code === "ALREADY_SIGNED") void fetchStatus();
        return;
      }
      toast.success("Consent resent");
      void fetchStatus();
    } catch {
      toast.error("Failed to resend consent");
    }
  }

  const consentStatus = status?.status ?? "none";
  const readiness = status?.readiness ?? null;
  const profileIncomplete = consentStatus === "none" && !!readiness && !readiness.ready;
  const actionsBlocked = profileIncomplete && !overrideProfile;
  const missingGroups: MissingGroupView[] = readiness
    ? readiness.groups?.length ? readiness.groups : [{ section: "", fields: readiness.missing }]
    : [];

  const dialogs = (
    <>
      <SendConsentDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          // Closing (also after an "already signed" refusal) re-reads the status so a stale view corrects itself.
          if (!next) void fetchStatus();
        }}
        leadId={leadId}
        tenantId={tenantId}
        defaultTab={dialogTab}
        allowCopyOnly={allowCopyOnly}
        overrideProfileCheck={overrideProfile}
        onSuccess={() => { setDialogOpen(false); void fetchStatus(); }}
      />

      {/* Owner/admin "send anyway" confirmation for an incomplete profile */}
      <Dialog open={overrideConfirmOpen} onOpenChange={setOverrideConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send consent with missing details?</DialogTitle>
            <DialogDescription>The student profile is missing:</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <ul className="list-disc pl-5">
              {(readiness?.missing ?? []).map((item) => (<li key={item}>{item}</li>))}
            </ul>
            <p className="text-muted-foreground">The consent document will go out with these details blank. This override is recorded in the audit log.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => { setOverrideProfile(true); setOverrideConfirmOpen(false); }}>Send anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signed-document preview — inline PDF in a modal instead of a new tab */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Signed Consent Document</DialogTitle>
          </DialogHeader>
          {status?.record?.document_url && (
            <iframe src={status.record.document_url} title="Signed consent document" className="w-full h-[70vh] rounded-[8px] border" />
          )}
          <DialogFooter className="sm:justify-between">
            {status?.record?.document_url && (
              <a href={status.record.document_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground hover:underline self-center">
                Open in new tab
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InPersonConsentDialog
        open={inPersonOpen}
        onOpenChange={(next) => { setInPersonOpen(next); if (!next) void fetchStatus(); }}
        leadId={leadId}
        overrideProfileCheck={overrideProfile}
        onSuccess={() => { setInPersonOpen(false); void fetchStatus(); }}
      />

      {noticeDialog}
    </>
  );

  return {
    status, loading, consentStatus, readiness, profileIncomplete, actionsBlocked, missingGroups, creatingLink, overrideProfile,
    fetchStatus, openDialog, handleCreateAndCopyLink, handleCopyLink, handleResend,
    openSendDialog: () => openDialog("send"),
    openManualDialog: () => openDialog("manual"),
    openInPerson: () => setInPersonOpen(true),
    openPreview: () => setPreviewOpen(true),
    askOverride: () => setOverrideConfirmOpen(true),
    /** The dialogs this flow opens. Render ONCE per page. */
    dialogs,
  };
}

export type ConsentApi = ReturnType<typeof useConsent>;
