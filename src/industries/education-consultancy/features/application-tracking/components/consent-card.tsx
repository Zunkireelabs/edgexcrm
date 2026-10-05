"use client";

import { SECTION_TITLE_CLASS } from "@/components/dashboard/lead/section-title";
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Clock, CheckCircle2, Loader2, Copy, RefreshCw, FileText, Upload, PenLine, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SendConsentDialog } from "./send-consent-dialog";
import { InPersonConsentDialog } from "./in-person-consent-dialog";
import { useBlockingNotice } from "@/components/dashboard/blocking-notice";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type FeeStatus = "paid" | "unpaid" | "waiver";

interface ConsentStatus {
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
  readiness?: { ready: boolean; missing: string[] } | null;
}

/** Disabled buttons don't receive hover, so the tooltip lives on a wrapper. No `hint` = no wrapper at all. */
function BlockedHint({ hint, className, children }: { hint: string[] | null; className: string; children: React.ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={className}>{children}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">Complete the student profile first</p>
          <ul className="mt-1 list-disc pl-4">
            {hint.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-1 opacity-80">Add them in Student Details (Edit).</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Optional label overrides so non-education industries can reuse this card
 * verbatim (e.g. real_estate renders it as a "Subscription Agreement"). All
 * fields default to the education wording, so an education caller that passes
 * nothing gets byte-identical behavior.
 */
interface ConsentCardLabels {
  sectionTitle?: string;   // collapsible header — default "Pre Application"
  docLabel?: string;       // sub-label — default "Student Consent"
  requiredTitle?: string;  // default "Consent required"
  requiredHelp?: string;   // default the student-must-sign sentence
  awaitingHelp?: string;   // default "Consent sent · awaiting student signature"
  signedTitle?: string;    // default "Consent signed"
}

interface ConsentCardProps {
  leadId: string;
  tenantId: string;
  consentEnabled: boolean;
  consentSigned: boolean;
  canManage: boolean;
  /** Processing fee is owner/admin-only (not branch-manager/assignee like canManage) — see API guard in apply-lead-patch.ts. */
  canManageFee: boolean;
  onSignedChange?: (signed: boolean) => void;
  // Pre-Application fee (migration 084) — current lead-level values
  feeStatus?: FeeStatus | null;
  feeAmount?: number | null;
  feeNotes?: string | null;
  // Cross-industry reuse — optional label overrides + fee-section toggle.
  labels?: ConsentCardLabels;
  showProcessingFee?: boolean; // default true (education); false hides the fee block
  /** Education: adds "Copy consent link" (create the signing link without emailing it) and lays the first-state buttons out two per row. */
  showCopyLink?: boolean;
  /** Education: while the card is collapsed, show the status in the header ("Consent required" / "Consent signed") so it isn't hidden. */
  showCollapsedStatus?: boolean;
  /** Changes whenever the student's profile fields change, so the card re-checks whether consent is allowed. */
  profileKey?: string;
  /** Lead page only: opens the Student Details pop-up in edit mode (the warning shows an "Open Student Details" button when given). */
  onOpenStudentDetails?: () => void;
}

export function ConsentCard({
  leadId,
  tenantId,
  canManage,
  canManageFee,
  onSignedChange,
  feeStatus: initialFeeStatus = null,
  feeAmount: initialFeeAmount = null,
  feeNotes: initialFeeNotes = null,
  labels,
  showProcessingFee = true,
  showCopyLink = false,
  showCollapsedStatus = false,
  profileKey,
  onOpenStudentDetails,
}: ConsentCardProps) {
  // Effective labels — education wording unless a caller overrides.
  const L = {
    sectionTitle: labels?.sectionTitle ?? "Pre Application",
    docLabel: labels?.docLabel ?? "Student Consent",
    requiredTitle: labels?.requiredTitle ?? "Consent required",
    requiredHelp:
      labels?.requiredHelp ??
      "This student must sign a consent document before an application can be created.",
    awaitingHelp: labels?.awaitingHelp ?? "Consent sent · awaiting student signature",
    signedTitle: labels?.signedTitle ?? "Consent signed",
  };
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"send" | "manual">("send");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inPersonOpen, setInPersonOpen] = useState(false);

  // ── Pre-Application fee ──────────────────────────────────────────────
  const [feeStatus, setFeeStatus] = useState<FeeStatus | "">(initialFeeStatus ?? "");
  const [feeAmount, setFeeAmount] = useState(
    initialFeeAmount !== null && initialFeeAmount !== undefined ? String(initialFeeAmount) : "",
  );
  const [feeNotes, setFeeNotes] = useState(initialFeeNotes ?? "");
  const [open, setOpen] = useState(false); // collapsible: collapsed by default
  const [feeDirty, setFeeDirty] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);

  async function saveFee() {
    setFeeSaving(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre_app_fee_status: feeStatus || null,
          pre_app_fee_amount:
            feeStatus === "paid" && feeAmount !== "" ? Number(feeAmount) : null,
          pre_app_fee_notes: feeNotes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Processing fee saved");
      setFeeDirty(false);
    } catch {
      toast.error("Failed to save application fee");
    } finally {
      setFeeSaving(false);
    }
  }

  const [creatingLink, setCreatingLink] = useState(false);
  // Owner/admin chose "Send anyway" for an incomplete profile (after confirming). Resets on reload.
  const [overrideProfile, setOverrideProfile] = useState(false);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
  const overrideBody = overrideProfile ? { override_profile_check: true } : {};
  const { notify, noticeDialog } = useBlockingNotice();

  // One click: create the signing link WITHOUT emailing the student, copy it, and let the card move on to
  // "Awaiting signature" (which keeps its own Copy link button if the clipboard is unavailable).
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
        if (json.error?.code === "ALREADY_SIGNED") fetchStatus();
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
      fetchStatus();
    } catch {
      toast.error("Failed to create consent link");
    } finally {
      setCreatingLink(false);
    }
  }

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/consent`);
      if (!res.ok) return;
      const { data } = await res.json();
      setStatus(data as ConsentStatus);
      onSignedChange?.((data as ConsentStatus).status === "signed");
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [leadId, onSignedChange]);

  // profileKey changes when the student's details are edited, so the "complete the profile" gate updates live.
  useEffect(() => { fetchStatus(); }, [fetchStatus, profileKey]);

  function openDialog(tab: "send" | "manual") {
    setDialogTab(tab);
    setDialogOpen(true);
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
        // The student signed while this card still showed "awaiting signature": re-read the status
        // so the card (and the Applications "+") correct themselves instead of staying stale.
        if (json.error?.code === "ALREADY_SIGNED") fetchStatus();
        return;
      }
      toast.success("Consent resent");
      fetchStatus();
    } catch {
      toast.error("Failed to resend consent");
    }
  }

  if (loading) {
    return (
      <Card className="shadow-none rounded-lg py-0">
        <CardContent className="pt-4 pb-4">
          <div className="flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const current = status;
  const consentStatus = current?.status ?? "none";
  // Education profile gate: all four consent actions wait for a complete student profile.
  const readiness = current?.readiness ?? null;
  const profileIncomplete = consentStatus === "none" && !!readiness && !readiness.ready;
  const actionsBlocked = profileIncomplete && !overrideProfile;
  const canOverride = canManageFee; // owner/admin only — the API re-checks the role
  const blockedHint = actionsBlocked && readiness ? readiness.missing : null;
  const hintWrapClass = showCopyLink ? "block [&>button]:w-full" : "inline-block";

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            {/* Title + status badge sit side by side; if a very narrow column can't fit both, the badge wraps below the title instead of squeezing it. */}
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`${SECTION_TITLE_CLASS} whitespace-nowrap`}>
                {L.sectionTitle}
              </span>
              {showCollapsedStatus && !open && consentStatus === "none" && (
                <span
                  title={L.requiredTitle}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Required
                </span>
              )}
              {showCollapsedStatus && !open && consentStatus === "signed" && (
                <span
                  title={L.signedTitle}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                >
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  Signed
                </span>
              )}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CardHeader>
        {open && (
        <CardContent className="pb-4 space-y-3">
          {/* ── Processing Fee (pre-application, lead-level) — education only. Shown above the consent. ── */}
          {showProcessingFee && (
          <div className="border-b pb-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Processing Fee</p>

            {canManageFee ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Fee Paid?</Label>
                  <Select
                    value={feeStatus}
                    onValueChange={(v) => {
                      setFeeStatus(v as FeeStatus);
                      setFeeDirty(true);
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="waiver">Waiver</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {feeStatus === "paid" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={feeAmount}
                      onChange={(e) => {
                        setFeeAmount(e.target.value);
                        setFeeDirty(true);
                      }}
                      className="h-8 text-sm"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <Textarea
                    placeholder="Optional notes"
                    value={feeNotes}
                    onChange={(e) => {
                      setFeeNotes(e.target.value);
                      setFeeDirty(true);
                    }}
                    className="text-sm min-h-[60px]"
                  />
                </div>

                {feeDirty && (
                  <Button size="sm" onClick={saveFee} disabled={feeSaving} className="h-7 text-xs">
                    {feeSaving ? "Saving…" : "Save fee"}
                  </Button>
                )}
              </>
            ) : feeStatus ? (
              <div className="text-sm space-y-1">
                <p className="capitalize">
                  {feeStatus}
                  {feeStatus === "paid" && feeAmount !== "" && (
                    <span className="text-muted-foreground"> · {feeAmount}</span>
                  )}
                </p>
                {feeNotes && <p className="text-xs text-muted-foreground">{feeNotes}</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Not set</p>
            )}
          </div>
          )}

          <p className="text-xs font-medium text-muted-foreground">{L.docLabel}</p>
          {consentStatus === "none" && (
            <>
              <div className="flex items-start gap-2 text-amber-600">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-sm font-medium">{L.requiredTitle}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {L.requiredHelp}
              </p>
              {profileIncomplete && readiness && (
                <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Complete the student profile first</p>
                      <p className="text-xs">
                        A half-filled profile makes a consent document with blank details, which can cause problems.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs">
                    <p className="font-medium">Still missing:</p>
                    <ul className="mt-0.5 list-disc pl-4">
                      {readiness.missing.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-amber-800">Add them from Student Details (Edit).</p>
                  </div>
                  {onOpenStudentDetails && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenStudentDetails}
                      className="h-7 border-amber-300 bg-white px-2 text-xs text-amber-900 hover:bg-amber-100"
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Open Student Details
                    </Button>
                  )}
                  {canOverride && !overrideProfile && (
                    <button
                      type="button"
                      onClick={() => setOverrideConfirmOpen(true)}
                      className="text-xs font-medium underline underline-offset-2 hover:text-amber-950"
                    >
                      Send anyway (admin)
                    </button>
                  )}
                  {overrideProfile && (
                    <p className="text-xs font-medium">Admin override on — consent can go out with the details above blank.</p>
                  )}
                </div>
              )}
              {canManage && (
                <div className={showCopyLink ? "grid grid-cols-2 gap-2" : "flex gap-2 flex-wrap"}>
                  <BlockedHint hint={blockedHint} className={hintWrapClass}>
<Button size="sm" variant="outline" disabled={actionsBlocked} onClick={() => openDialog("send")} className={`h-7 text-xs${showCopyLink ? " px-2" : ""}`}>
                    Send consent link
                  </Button>
</BlockedHint>
                  {showCopyLink && (
                    <BlockedHint hint={blockedHint} className={hintWrapClass}>
<Button size="sm" variant="outline" onClick={handleCreateAndCopyLink} disabled={creatingLink || actionsBlocked} className="h-7 px-2 text-xs">
                      {creatingLink ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Copy className="h-3 w-3 mr-1" />
                      )}
                      Copy consent link
                    </Button>
</BlockedHint>
                  )}
                  <BlockedHint hint={blockedHint} className={hintWrapClass}>
<Button size="sm" variant="outline" disabled={actionsBlocked} onClick={() => setInPersonOpen(true)} className={`h-7 text-xs${showCopyLink ? " px-2" : ""}`}>
                    <PenLine className="h-3 w-3 mr-1" />
                    Sign here now
                  </Button>
</BlockedHint>
                  <BlockedHint hint={blockedHint} className={hintWrapClass}>
<Button size="sm" variant={showCopyLink ? "outline" : "ghost"} disabled={actionsBlocked} onClick={() => openDialog("manual")} className={`h-7 text-xs${showCopyLink ? " px-2" : ""}`}>
                    <Upload className="h-3 w-3 mr-1" />
                    Record manually
                  </Button>
</BlockedHint>
                </div>
              )}
            </>
          )}

          {(consentStatus === "sent" || consentStatus === "expired") && (
            <>
              <div className="flex items-start gap-2 text-blue-600">
                <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-sm font-medium">
                  {consentStatus === "expired" ? "Consent link expired" : "Awaiting signature"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {consentStatus === "expired"
                  ? "The consent link has expired. Resend to generate a new one."
                  : L.awaitingHelp}
              </p>
              {canManage && (
                <div className="flex gap-2 flex-wrap">
                  {consentStatus === "sent" && current?.link && (
                    <Button size="sm" variant="outline" onClick={handleCopyLink} className="h-7 text-xs">
                      <Copy className="h-3 w-3 mr-1" />
                      Copy link
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={handleResend} className="h-7 text-xs">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {consentStatus === "expired" ? "Resend" : "Resend"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setInPersonOpen(true)} className="h-7 text-xs">
                    <PenLine className="h-3 w-3 mr-1" />
                    Sign here now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openDialog("manual")} className="h-7 text-xs">
                    <Upload className="h-3 w-3 mr-1" />
                    Record manually
                  </Button>
                </div>
              )}
            </>
          )}

          {consentStatus === "signed" && (
            <>
              <div className="flex items-start gap-2 text-green-600">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{L.signedTitle}</p>
                  {current?.record?.signer_name && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {current.record.signer_name}
                      {current.record.signed_at && (
                        <> · {new Date(current.record.signed_at).toLocaleDateString()}</>
                      )}
                    </p>
                  )}
                </div>
              </div>
              {current?.record?.document_url && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPreviewOpen(true)}
                >
                  <FileText className="h-3 w-3 mr-1" />
                  View document
                </Button>
              )}
            </>
          )}
        </CardContent>
        )}
      </Card>

      <SendConsentDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          // Closing (also after an "already signed" refusal) re-reads the status so a stale card corrects itself.
          if (!next) fetchStatus();
        }}
        leadId={leadId}
        tenantId={tenantId}
        defaultTab={dialogTab}
        allowCopyOnly={showCopyLink}
        overrideProfileCheck={overrideProfile}
        onSuccess={() => {
          setDialogOpen(false);
          fetchStatus();
        }}
      />

      {/* Owner/admin "send anyway" confirmation for an incomplete profile */}
      <Dialog open={overrideConfirmOpen} onOpenChange={setOverrideConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send consent with missing details?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>The student profile is missing:</p>
            <ul className="list-disc pl-5">
              {(readiness?.missing ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              The consent document will go out with these details blank. This override is recorded in the audit log.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setOverrideProfile(true);
                setOverrideConfirmOpen(false);
              }}
            >
              Send anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signed-document preview — inline PDF in a modal instead of a new tab */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Signed Consent Document</DialogTitle>
          </DialogHeader>
          {current?.record?.document_url && (
            <iframe
              src={current.record.document_url}
              title="Signed consent document"
              className="w-full h-[70vh] rounded-md border"
            />
          )}
          <DialogFooter className="sm:justify-between">
            {current?.record?.document_url && (
              <a
                href={current.record.document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline self-center"
              >
                Open in new tab
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InPersonConsentDialog
        open={inPersonOpen}
        onOpenChange={(next) => {
          setInPersonOpen(next);
          if (!next) fetchStatus();
        }}
        leadId={leadId}
        overrideProfileCheck={overrideProfile}
        onSuccess={() => {
          setInPersonOpen(false);
          fetchStatus();
        }}
      />

      {noticeDialog}
    </>
  );
}
