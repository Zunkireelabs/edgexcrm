"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Clock, CheckCircle2, Loader2, Copy, RefreshCw, FileText, Upload } from "lucide-react";
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
import { SendConsentDialog } from "./send-consent-dialog";

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

interface ConsentCardProps {
  leadId: string;
  tenantId: string;
  consentEnabled: boolean;
  consentSigned: boolean;
  canManage: boolean;
  onSignedChange?: (signed: boolean) => void;
}

export function ConsentCard({ leadId, tenantId, canManage, onSignedChange }: ConsentCardProps) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"send" | "manual">("send");
  const [previewOpen, setPreviewOpen] = useState(false);

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
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Student Consent
          </span>
        </CardHeader>
        <CardContent className="pb-4 space-y-3">
          {consentStatus === "none" && (
            <>
              <div className="flex items-start gap-2 text-amber-600">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-sm font-medium">Consent required</p>
              </div>
              <p className="text-xs text-muted-foreground">
                This student must sign a consent document before an application can be created.
              </p>
              {canManage && (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openDialog("send")} className="h-7 text-xs">
                    Send consent link
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
                  : "Consent sent · awaiting student signature"}
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
                  <p className="text-sm font-medium">Consent signed</p>
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
    </>
  );
}
