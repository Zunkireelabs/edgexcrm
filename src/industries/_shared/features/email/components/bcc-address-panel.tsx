"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBccAddress } from "../hooks/use-bcc-address";

// Brief §4/§6: BCC dropbox — a stable, personal, revocable address the rep
// BCCs on mail sent from their own Gmail client. Renders nothing when the
// double gate (EDGEX_INBOUND_ENABLED && tenant_email_settings.inbound_enabled)
// is off — the API 404s in that case (use-bcc-address.ts).
export function BccAddressPanel() {
  const { address, enabled, loading, regenerate } = useBccAddress();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  if (loading || !enabled) return null;

  async function handleCopy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast.success("Copied to clipboard");
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const ok = await regenerate();
      if (ok) {
        toast.success("New BCC address minted — the old one stopped working");
      } else {
        toast.error("Could not regenerate BCC address");
      }
    } finally {
      setRegenerating(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="border border-border bg-card rounded-lg shadow-none p-3 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Your BCC address</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Save this as a contact in your own Gmail and BCC it on emails you send to leads from your
          personal inbox. EdgeX logs the message against the right lead automatically — no
          connection required.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
          {address}
        </code>
        <Button size="sm" variant="outline" onClick={handleCopy} disabled={!address}>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)} disabled={!address}>
          <RefreshCw className="h-3.5 w-3.5" />
          Regenerate
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate your BCC address?</AlertDialogTitle>
            <AlertDialogDescription>
              Your old address stops working immediately. Any Gmail contact or draft still pointing
              at it will need to be updated to the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerate} disabled={regenerating}>
              {regenerating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
