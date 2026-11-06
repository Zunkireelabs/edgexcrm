"use client";

import { WarningIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ApplicationsGateDialogProps {
  /** What is still missing (e.g. "Processing fee", "Consent signed"); null = closed. */
  missing: string[] | null;
  onClose: () => void;
  /** When given, shows an "Edit profile" button that opens the Student Details pop-up with the missing fields in red. */
  onEditProfile?: () => void;
}

// Shown immediately when a move into Applications is blocked, instead of a small corner toast.
// Read-only: it tells staff exactly what to complete first.
export function ApplicationsGateDialog({ missing, onClose, onEditProfile }: ApplicationsGateDialogProps) {
  return (
    <Dialog open={missing !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <WarningIcon className="h-5 w-5" />
            Can&apos;t move to Applications yet
          </DialogTitle>
          <DialogDescription>Complete the following before moving this lead to Applications:</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2" data-testid="gate-missing-list">
          {(missing ?? []).map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-red-600">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {onEditProfile && (
            <Button onClick={onEditProfile}>Edit profile</Button>
          )}
          <Button variant={onEditProfile ? "outline" : "default"} onClick={onClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
