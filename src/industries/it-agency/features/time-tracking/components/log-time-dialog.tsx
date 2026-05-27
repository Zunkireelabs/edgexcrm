"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeEntryAddForm } from "./time-entry-add-form";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface LogTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (entry: TimeEntryWithJoins) => void;
  /** Pre-selected project. */
  defaultProjectId?: string;
  /** Pre-selected task (requires defaultProjectId). */
  defaultTaskId?: string;
}

export function LogTimeDialog({
  open,
  onOpenChange,
  onSuccess,
  defaultProjectId,
  defaultTaskId,
}: LogTimeDialogProps) {
  function handleSuccess(entry: TimeEntryWithJoins) {
    onSuccess(entry);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Time</DialogTitle>
        </DialogHeader>
        <TimeEntryAddForm
          onSuccess={handleSuccess}
          onCancel={() => onOpenChange(false)}
          defaultProjectId={defaultProjectId}
          defaultTaskId={defaultTaskId}
        />
      </DialogContent>
    </Dialog>
  );
}
