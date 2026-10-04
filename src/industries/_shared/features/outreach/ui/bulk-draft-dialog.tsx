"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BULK_DRAFT_CONFIRM_FROM } from "../lib/bulk-draft-constants";
import { formatDateTime12 } from "../lib/time-format";
import { DateTimePicker } from "./time-of-day-picker";

// Confirm + run a bulk action on drafts in Outreach -> Today (Send now / Schedule / Skip for many).
// send / schedule are ONE request (the server only sets the send time — the scheduled-send timer does the sending);
// skip runs in short batches the dialog repeats until none are left, showing progress. From 50 drafts up the person must
// type the action word first.

export type BulkDraftAction = "send" | "schedule" | "skip";
export type BulkDraftSelection = { mode: "ids"; ids: string[] } | { mode: "all"; due: "today" | "all" };

interface BulkDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkDraftAction;
  selection: BulkDraftSelection;
  /** How many drafts this will act on (the page's picks, or the whole matching total). */
  count: number;
  /** The sandbox is on: emails go to the test address, not to the leads. */
  sandbox: boolean;
  onDone: () => void;
}

const WORD: Record<BulkDraftAction, string> = { send: "SEND", schedule: "SCHEDULE", skip: "SKIP" };

/** `<input type="datetime-local">` works in local time with no zone — format a Date that way. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tomorrowAt9(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function extractError(json: unknown): string | null {
  const j = json as { error?: { message?: string }; errors?: Record<string, string[]> } | null;
  const first = j?.errors ? Object.values(j.errors).flat()[0] : undefined;
  return first ?? j?.error?.message ?? null;
}

export function BulkDraftDialog({
  open,
  onOpenChange,
  action,
  selection,
  count,
  sandbox,
  onDone,
}: BulkDraftDialogProps) {
  const [sendAt, setSendAt] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSendAt(toLocalInputValue(tomorrowAt9()));
      setConfirmText("");
      setRunning(false);
      setProgress(0);
      setError(null);
    }
  }, [open]);

  const needsConfirm = count >= BULK_DRAFT_CONFIRM_FROM;
  const confirmed = !needsConfirm || confirmText.trim().toUpperCase() === WORD[action];
  const plural = count === 1 ? "" : "s";

  const request = async (extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/v1/outreach/drafts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        selection: selection.mode === "ids" ? { mode: "ids", ids: selection.ids } : { mode: "all", due: selection.due },
        confirm: needsConfirm ? true : undefined,
        ...extra,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(extractError(json) ?? "That didn't work");
    return json.data as {
      applied: number;
      failed?: number;
      remaining: number;
      skipped: { no_subject: number; no_email: number; not_available: number };
      sandbox?: boolean;
    };
  };

  const describeLeftOut = (s: { no_subject: number; no_email: number; not_available: number }) => {
    const parts = [
      s.no_email > 0 && `${s.no_email.toLocaleString()} with no email`,
      s.no_subject > 0 && `${s.no_subject.toLocaleString()} with no subject`,
      s.not_available > 0 && `${s.not_available.toLocaleString()} no longer available`,
    ].filter(Boolean);
    return parts.length > 0 ? ` Left out: ${parts.join(", ")}.` : "";
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    let touched = false; // a skip run may have done part of the job before failing
    try {
      if (action === "skip") {
        let applied = 0;
        let failed = 0;
        for (;;) {
          const data = await request();
          touched = true;
          applied += data.applied;
          failed += data.failed ?? 0;
          setProgress(applied + failed);
          // done, or nothing moved this round (don't spin forever)
          if (data.remaining <= 0 || data.applied + (data.failed ?? 0) === 0) break;
        }
        toast.success(
          `Skipped ${applied.toLocaleString()} email${applied === 1 ? "" : "s"}${failed > 0 ? ` (${failed.toLocaleString()} couldn't be skipped)` : ""}`,
        );
      } else if (action === "send") {
        const data = await request();
        toast.success(
          `${data.applied.toLocaleString()} email${data.applied === 1 ? "" : "s"} queued — they go out over the next few minutes, within your daily limit.${describeLeftOut(data.skipped)}`,
        );
      } else {
        const when = new Date(sendAt);
        const data = await request({ send_at: when.toISOString() });
        toast.success(
          `${data.applied.toLocaleString()} email${data.applied === 1 ? "" : "s"} scheduled for ${formatDateTime12(when)}.${describeLeftOut(data.skipped)}`,
        );
      }
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
      // refresh the list behind this dialog if some of it already happened
      if (touched) onDone();
    } finally {
      setRunning(false);
    }
  };

  const title =
    action === "send"
      ? `Send ${count.toLocaleString()} email${plural} now?`
      : action === "schedule"
        ? `Schedule ${count.toLocaleString()} email${plural}?`
        : `Skip ${count.toLocaleString()} email${plural}?`;

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {action === "send" &&
              "EdgeX queues them and sends them over the next few minutes, within your daily send limit — anything over the limit goes out the next day."}
            {action === "schedule" && "EdgeX sends them at the time you choose, within your daily send limit."}
            {action === "skip" &&
              "Each lead moves on to the next step of their sequence without this email. This can't be undone."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {action === "schedule" && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-draft-send-at">Send on</Label>
              <DateTimePicker id="bulk-draft-send-at" value={sendAt} onChange={setSendAt} min={toLocalInputValue(new Date())} />
              <p className="text-xs text-muted-foreground">
                Your local time. At least 5 minutes from now, within 90 days.
              </p>
            </div>
          )}

          {action !== "skip" && sandbox && (
            <p className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Sandbox is on: these go to the configured test address, not to the leads.</span>
            </p>
          )}

          {needsConfirm && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-draft-confirm">
                Type <strong>{WORD[action]}</strong> to confirm ({count.toLocaleString()} emails)
              </Label>
              <Input
                id="bulk-draft-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={WORD[action]}
                autoComplete="off"
              />
            </div>
          )}

          {running && action === "skip" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Skipped {progress.toLocaleString()} of{" "}
              {count.toLocaleString()}…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button
            onClick={run}
            disabled={running || !confirmed || (action === "schedule" && !sendAt)}
            variant={action === "skip" ? "destructive" : "default"}
          >
            {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {action === "send" ? "Send now" : action === "schedule" ? "Schedule" : "Skip them"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
