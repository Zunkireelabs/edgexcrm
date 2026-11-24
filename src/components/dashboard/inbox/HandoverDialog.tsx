"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface HandoverMember {
  user_id: string;
  name: string;
}

interface HandoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Team members who can open the Inbox (GET /api/v1/inbox/handover-targets). The current user is left out. */
  members: HandoverMember[];
  currentUserId: string;
  contactName: string;
  onConfirm: (toUserId: string) => Promise<void>;
}

/** "Hand over this chat": the owner picks a teammate who takes over as the only person who can reply. */
export function HandoverDialog({ open, onOpenChange, members, currentUserId, contactName, onConfirm }: HandoverDialogProps) {
  const choices = members.filter((m) => m.user_id !== currentUserId);
  const [toUserId, setToUserId] = useState("");
  const [busy, setBusy] = useState(false);

  // Start from a clean choice every time the window opens.
  useEffect(() => {
    if (open) setToUserId("");
  }, [open]);

  const confirm = async () => {
    if (!toUserId || busy) return;
    setBusy(true);
    try {
      await onConfirm(toUserId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Hand over this chat</DialogTitle>
          <DialogDescription>
            Who should handle {contactName}&apos;s chat? They get a notification and become the only person who can reply.
          </DialogDescription>
        </DialogHeader>

        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">There is nobody else who can open the Inbox to hand this chat to.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="handover-to" className="text-xs text-muted-foreground">Hand over to</label>
            <select
              id="handover-to"
              value={toUserId}
              onChange={(e) => setToUserId(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Choose a teammate…</option>
              {choices.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} disabled={!toUserId || busy}>
            {busy && <CircleNotchIcon className="h-4 w-4 mr-2 animate-spin" />}
            Hand over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
