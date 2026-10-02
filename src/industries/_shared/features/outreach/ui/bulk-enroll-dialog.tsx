"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Download, AlertTriangle } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useSequences } from "../hooks/use-sequences";

// "Enroll in sequence" for MANY leads (OUTREACH-BULK-ENROLL-BRIEF.md §4). Steps:
//   pick a sequence -> preview (nothing is written) -> Start (type-to-confirm from `confirmFrom` leads)
//   -> live progress with Cancel -> result + download of the skipped leads.
// Closing the dialog never stops a running enrollment; reopening is not needed — the result is also in the
// Enrollments tab.

export type BulkEnrollSource =
  | { mode: "selected"; leadIds: string[] }
  | { mode: "filter"; tree: unknown };

type Policy = "skip" | "switch" | "queue";

interface Preview {
  matched: number;
  notVisible: number;
  willEnroll: number;
  skipped: { noEmail: number; malformedEmail: number; duplicateEmail: number; suppressed: number; alreadyInSequence: number };
  overLimit: boolean;
  limit: number;
  confirmFrom: number;
  cap: { dailyCap: number; sentToday: number; remaining: number };
  estimatedExtraDays: number;
  conflictPolicy: Policy;
  inOtherSequence: number;
  willSwitch: number;
  willQueue: number;
  sandbox: boolean;
  sendingEnabled: boolean;
  sampleNames: string[];
  sequence: { id: string; name: string; auto_send: boolean };
}

interface Run {
  id: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  total_count: number;
  enrolled_count: number;
  skipped_count: number;
  failed_count: number;
  cancel_requested: boolean;
  error: string | null;
  /** leads parked to start when their current sequence ends (policy "queue") */
  queued_count?: number;
}

const CONFIRM_WORD = "ENROLL";
const POLL_MS = 2000;

interface BulkEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: BulkEnrollSource;
  /** e.g. "42 selected leads" */
  sourceLabel: string;
  presetSequenceId?: string;
  onFinished?: () => void;
}

function isFinal(status: Run["status"]) {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export function BulkEnrollDialog({ open, onOpenChange, source, sourceLabel, presetSequenceId, onFinished }: BulkEnrollDialogProps) {
  const { sequences, loading: sequencesLoading } = useSequences();
  const [sequenceId, setSequenceId] = useState(presetSequenceId ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [policy, setPolicy] = useState<Policy>("skip");
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const finishedRef = useRef(false);

  // reset whenever the dialog opens
  useEffect(() => {
    if (open) {
      setSequenceId(presetSequenceId ?? "");
      setPreview(null);
      setError(null);
      setConfirmText("");
      setPolicy("skip");
      setRun(null);
      setRunId(null);
      setStarting(false);
      finishedRef.current = false;
    }
  }, [open, presetSequenceId]);

  const sourceKey = JSON.stringify(source);

  // Preview whenever the sequence (or the source) changes — only before a run exists.
  useEffect(() => {
    if (!open || !sequenceId || runId) return;
    let cancelled = false;
    setPreviewLoading(true);
    setError(null);
    setPreview(null);
    (async () => {
      try {
        const res = await fetch("/api/v1/outreach/bulk-enroll/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequence_id: sequenceId, source: toApiSource(source), conflict_policy: policy }),
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(extractError(json) ?? "Couldn't prepare the preview");
          return;
        }
        setPreview(json.data as Preview);
      } catch {
        if (!cancelled) setError("Couldn't prepare the preview");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sequenceId, sourceKey, runId, policy]);

  // Poll a running enrollment.
  const fetchRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/outreach/bulk-enroll/${id}`);
    if (!res.ok) return null;
    return ((await res.json()).data ?? null) as Run | null;
  }, []);

  useEffect(() => {
    if (!open || !runId) return;
    let stop = false;
    const tick = async () => {
      const latest = await fetchRun(runId);
      if (stop || !latest) return;
      setRun(latest);
      if (isFinal(latest.status)) {
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinished?.();
        }
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [open, runId, fetchRun, onFinished]);

  const needsConfirm = !!preview && preview.willEnroll >= preview.confirmFrom;
  const canStart =
    !!preview && !starting && !preview.overLimit && preview.willEnroll > 0 && (!needsConfirm || confirmText.trim().toUpperCase() === CONFIRM_WORD);

  const start = async () => {
    if (!preview) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/outreach/bulk-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence_id: sequenceId,
          source: toApiSource(source),
          conflict_policy: policy,
          confirm: needsConfirm ? true : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(extractError(json) ?? "Couldn't start the enrollment");
        return;
      }
      setRunId(json.data.run_id as string);
    } catch {
      setError("Couldn't start the enrollment");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!runId) return;
    const res = await fetch(`/api/v1/outreach/bulk-enroll/${runId}/cancel`, { method: "POST" });
    if (res.ok) toast.success("Cancelling — leads already enrolled stay enrolled");
    else toast.error("Couldn't cancel");
  };

  const processed = run ? run.enrolled_count + run.failed_count : 0;
  const total = run?.total_count ?? preview?.willEnroll ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll in sequence</DialogTitle>
          <DialogDescription>{sourceLabel}</DialogDescription>
        </DialogHeader>

        {!runId && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-seq">Sequence</Label>
              <Select value={sequenceId} onValueChange={setSequenceId} disabled={sequencesLoading}>
                <SelectTrigger id="bulk-seq">
                  <SelectValue placeholder={sequencesLoading ? "Loading…" : "Choose a sequence"} />
                </SelectTrigger>
                <SelectContent>
                  {sequences.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.auto_send ? " · auto-send" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {previewLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking who can be enrolled…
              </p>
            )}

            {preview && (
              <div className="space-y-3 rounded-md border p-3 text-sm">
                <p>
                  <strong>{preview.willEnroll.toLocaleString()}</strong> will be enrolled
                  {preview.sampleNames.length > 0 && (
                    <span className="text-muted-foreground"> — e.g. {preview.sampleNames.join(", ")}</span>
                  )}
                </p>
                {preview.willSwitch > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {preview.willSwitch.toLocaleString()} of them leave their current sequence and start this one.
                  </p>
                )}
                {preview.willQueue > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {preview.willQueue.toLocaleString()} of them are queued — this sequence starts when their current one ends.
                  </p>
                )}
                <SkippedList preview={preview} />
                {preview.inOtherSequence > 0 && <PolicyChoice count={preview.inOtherSequence} value={policy} onChange={setPolicy} />}
                {preview.willEnroll > 0 && (
                  <p className="text-xs text-muted-foreground">
                    The daily send limit is {preview.cap.dailyCap.toLocaleString()} ({preview.cap.remaining.toLocaleString()} left today).
                    {preview.estimatedExtraDays > 0
                      ? ` First emails will take about ${preview.estimatedExtraDays + 1} days to go out.`
                      : " All first emails fit within today's limit."}
                  </p>
                )}
                {preview.sequence.auto_send && (
                  <Warning>This sequence sends automatically — nobody reviews the emails before they go out.</Warning>
                )}
                {!preview.sandbox && preview.sequence.auto_send && (
                  <Warning>Emails go to the real leads, not a test address.</Warning>
                )}
                {!preview.sendingEnabled && preview.sequence.auto_send && (
                  <Warning>Sending from EdgeX is turned off for this account, so the emails will wait.</Warning>
                )}
                {preview.overLimit && (
                  <Warning>
                    That is more than the {preview.limit.toLocaleString()} leads one run can enroll — narrow the selection.
                  </Warning>
                )}
              </div>
            )}

            {needsConfirm && !preview?.overLimit && (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-confirm">
                  Type <strong>{CONFIRM_WORD}</strong> to confirm enrolling {preview?.willEnroll.toLocaleString()} leads
                </Label>
                <Input id="bulk-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {runId && (
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${run && isFinal(run.status) && run.status === "completed" ? 100 : pct}%` }} />
            </div>
            <p className="text-sm">
              {run?.status === "completed" && "Done."}
              {run?.status === "cancelled" && "Cancelled."}
              {run?.status === "failed" && `Stopped: ${run.error ?? "something went wrong"}`}
              {(!run || !isFinal(run.status)) && `${processed.toLocaleString()} of ${total.toLocaleString()} enrolled…`}
            </p>
            {run && (
              <p className="text-xs text-muted-foreground">
                Enrolled {run.enrolled_count.toLocaleString()} · Skipped {run.skipped_count.toLocaleString()} · Failed {run.failed_count.toLocaleString()}
                {(run.queued_count ?? 0) > 0 && ` · Queued next ${run.queued_count!.toLocaleString()} (included in skipped)`}
              </p>
            )}
            {run && !isFinal(run.status) && (
              <p className="text-xs text-muted-foreground">You can close this window — it keeps running in the background.</p>
            )}
            {run && isFinal(run.status) && (run.skipped_count > 0 || run.failed_count > 0) && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/v1/outreach/bulk-enroll/${runId}/skipped`}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download skipped leads
                </a>
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          {!runId ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={start} disabled={!canStart}>
                {starting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Start
              </Button>
            </>
          ) : run && isFinal(run.status) ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="destructive" onClick={cancel} disabled={run?.cancel_requested}>
                {run?.cancel_requested ? "Cancelling…" : "Cancel enrollment"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const POLICY_OPTIONS: { value: Policy; label: string; hint: string }[] = [
  { value: "skip", label: "Skip them", hint: "Leave them in their current sequence." },
  { value: "switch", label: "Switch them", hint: "End their current sequence now and start this one." },
  { value: "queue", label: "Queue next", hint: "Start this one automatically when their current sequence ends." },
];

function PolicyChoice({ count, value, onChange }: { count: number; value: Policy; onChange: (p: Policy) => void }) {
  return (
    <fieldset className="space-y-1.5 rounded border p-2.5">
      <legend className="px-1 text-xs font-medium">
        {count.toLocaleString()} {count === 1 ? "lead is" : "leads are"} already in another sequence
      </legend>
      {POLICY_OPTIONS.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="bulk-policy" className="mt-1" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <span className="font-medium">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function SkippedList({ preview }: { preview: Preview }) {
  const rows: [string, number][] = [
    ["Already in a sequence", preview.skipped.alreadyInSequence],
    ["No email address", preview.skipped.noEmail],
    ["Invalid email address", preview.skipped.malformedEmail],
    ["Unsubscribed or bounced", preview.skipped.suppressed],
    ["Same email as another lead", preview.skipped.duplicateEmail],
    ["Not visible to you / not found", preview.notVisible],
  ];
  const shown = rows.filter(([, n]) => n > 0);
  if (shown.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground">Skipped:</p>
      <ul className="mt-1 space-y-0.5">
        {shown.map(([label, n]) => (
          <li key={label} className="flex justify-between">
            <span>{label}</span>
            <span className="tabular-nums">{n.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function toApiSource(source: BulkEnrollSource) {
  return source.mode === "selected"
    ? { mode: "selected", lead_ids: source.leadIds }
    : { mode: "filter", tree: source.tree };
}

function extractError(json: unknown): string | null {
  const j = json as { error?: { message?: string; details?: Record<string, string[]> } } | null;
  const details = j?.error?.details;
  if (details) {
    const first = Object.values(details).flat()[0];
    if (first) return first;
  }
  return j?.error?.message ?? null;
}
