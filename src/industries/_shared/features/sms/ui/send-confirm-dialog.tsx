"use client";

// The last line of defence (SMS-PHASE3B-BRIEF.md §3): the user must type the
// exact recipient count to enable Send, and a red banner names the real
// consequence when sandbox is off. `sandboxed` is threaded down from the
// server shell (isSmsSandbox() has no client-safe equivalent and the
// /preview contract has no field for it — see sms/[id]/page.tsx) rather than
// fetched, since 3A's contract deliberately has no endpoint for it.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

interface SendConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
  sandboxed: boolean;
  sending: boolean;
  error: string | null;
  onConfirm: () => void;
}

export function SendConfirmDialog({ open, onOpenChange, recipientCount, sandboxed, sending, error, onConfirm }: SendConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  const matches = typed.trim() === String(recipientCount);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm send</DialogTitle>
          <DialogDescription>This cannot be undone once messages start going out.</DialogDescription>
        </DialogHeader>

        {!sandboxed && (
          <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              This will send real SMS to {recipientCount} real phone number{recipientCount === 1 ? "" : "s"}.
            </span>
          </div>
        )}
        {sandboxed && (
          <div className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
            Sandbox mode is on — all {recipientCount} message{recipientCount === 1 ? "" : "s"} will be redirected to the configured test
            recipient(s), not the real audience.
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-count">
            Type <span className="font-semibold tabular-nums">{recipientCount}</span> to confirm
          </Label>
          <Input
            id="confirm-count"
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={String(recipientCount)}
            autoComplete="off"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || sending} onClick={onConfirm}>
            {sending ? "Sending…" : "Send now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
