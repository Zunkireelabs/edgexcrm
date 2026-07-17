"use client";

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
  onSignedChange?: (signed: boolean) => void;
  // Pre-Application fee (migration 084) — current lead-level values
  feeStatus?: FeeStatus | null;
  feeAmount?: number | null;
  feeNotes?: string | null;
  // Cross-industry reuse — optional label overrides + fee-section toggle.
  labels?: ConsentCardLabels;
  showProcessingFee?: boolean; // default true (education); false hides the fee block
}

export function ConsentCard({
  leadId,
  tenantId,
  canManage,
  onSignedChange,
  feeStatus: initialFeeStatus = null,
  feeAmount: initialFeeAmount = null,
  feeNotes: initialFeeNotes = null,
  labels,
  showProcessingFee = true,
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

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

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
        body: JSON.stringify({ action: "send" }),
      });
      if (!res.ok) {
        const json = await res.json();
        toast.error(json.error?.message ?? "Failed to resend consent");
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

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between"
          >
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {L.sectionTitle}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CardHeader>
        {open && (
        <CardContent className="pb-4 space-y-3">
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
              {canManage && (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openDialog("send")} className="h-7 text-xs">
                    Send consent link
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

          {/* ── Processing Fee (pre-application, lead-level) — education only ── */}
          {showProcessingFee && (
          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Processing Fee</p>

            {canManage ? (
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
        </CardContent>
        )}
      </Card>

      <SendConsentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leadId={leadId}
        tenantId={tenantId}
        defaultTab={dialogTab}
        onSuccess={() => {
          setDialogOpen(false);
          fetchStatus();
        }}
      />

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
        onOpenChange={setInPersonOpen}
        leadId={leadId}
        onSuccess={() => {
          setInPersonOpen(false);
          fetchStatus();
        }}
      />
    </>
  );
}
