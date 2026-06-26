"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ConsentSignForm } from "@/app/(widget)/consent/[token]/consent-sign-form";

interface InPersonConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  onSuccess: () => void;
}

type SessionState = "idle" | "loading" | "ready" | "signed";

interface ConsentSessionData {
  token: string;
  tenant: { name: string; logo_url: string | null };
  tenant_id: string;
  title: string;
  body_snapshot: string;
  require_drawn_signature: boolean;
}

export function InPersonConsentDialog({
  open,
  onOpenChange,
  leadId,
  onSuccess,
}: InPersonConsentDialogProps) {
  const [state, setState] = useState<SessionState>("idle");
  const [consentData, setConsentData] = useState<ConsentSessionData | null>(null);
  const [signerName, setSignerName] = useState("");

  useEffect(() => {
    if (!open) {
      setState("idle");
      setConsentData(null);
      setSignerName("");
      return;
    }

    setState("loading");

    async function init() {
      try {
        const sendRes = await fetch(`/api/v1/leads/${leadId}/consent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_in_person" }),
        });
        if (!sendRes.ok) throw new Error("send_failed");
        const sendJson = await sendRes.json();
        const token = (sendJson.data as { token: string }).token;

        const getRes = await fetch(`/api/public/consent/${token}`);
        if (!getRes.ok) throw new Error("fetch_failed");
        const getJson = await getRes.json();
        const data = getJson.data as {
          valid: boolean;
          tenant?: { name: string; logo_url: string | null };
          tenant_id?: string;
          title?: string;
          body_snapshot?: string;
          require_drawn_signature?: boolean;
        };

        if (!data.valid) throw new Error("invalid");

        setConsentData({
          token,
          tenant: data.tenant!,
          tenant_id: data.tenant_id!,
          title: data.title!,
          body_snapshot: data.body_snapshot!,
          require_drawn_signature: data.require_drawn_signature ?? false,
        });
        setState("ready");
      } catch {
        toast.error("Failed to start signing session");
        onOpenChange(false);
      }
    }

    init();
  }, [open, leadId, onOpenChange]);

  function handleSigned(name: string) {
    setSignerName(name);
    setState("signed");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <span className="sr-only">Student Consent — In-Person Signing</span>

        {state === "loading" && (
          <div className="flex items-center justify-center py-16 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Preparing signing session…</span>
          </div>
        )}

        {state === "ready" && consentData && (
          <div>
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
              <p className="text-sm text-amber-800 font-medium">
                Student signing mode — hand this device to the student to complete the form below.
              </p>
            </div>
            <div className="px-4">
              <ConsentSignForm
                token={consentData.token}
                tenant={consentData.tenant}
                tenantId={consentData.tenant_id}
                title={consentData.title}
                bodySnapshot={consentData.body_snapshot}
                requireDrawnSignature={consentData.require_drawn_signature}
                compact
                onComplete={handleSigned}
              />
            </div>
          </div>
        )}

        {state === "signed" && (
          <div className="flex flex-col items-center justify-center py-12 px-6 gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <p className="text-base font-semibold text-gray-900">
              Consent signed — {signerName}
            </p>
            <Button variant="outline" onClick={onSuccess}>
              Return to staff view
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
