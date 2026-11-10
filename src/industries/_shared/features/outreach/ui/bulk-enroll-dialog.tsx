"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, CheckIcon, ChatTextIcon, CircleNotchIcon, DownloadIcon, EnvelopeSimpleIcon, InfoIcon, WarningIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogKeyHint,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommandDialog, type CommandItem } from "@/components/dashboard/leads/table/command-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSequences } from "../hooks/use-sequences";
import { AudienceFilterPicker } from "./audience-picker";
import type { FilterTree } from "@/lib/filters/types";
import type { OutreachChannel } from "../lib/channel";

// "Enroll in sequence" for MANY leads (OUTREACH-BULK-ENROLL-BRIEF.md §4; look: EDGEX-145 Dialogs v1). Steps:
//   pick a sequence (searchable list, the shared CommandDialog) -> preview (nothing is written) -> Start (type-to-confirm from `confirmFrom` leads)
//   -> live progress with Cancel -> result + download of the skipped leads.
// Closing the dialog never stops a running enrollment; reopening is not needed — the result is also in the
// Enrollments tab.

export type BulkEnrollSource = { mode: "selected"; leadIds: string[] } | { mode: "filter"; tree: unknown };

type Policy = "skip" | "switch" | "queue";

interface SmsPreview {
  creditsFirstStep: number;
  creditsAllSteps: number;
  stepCount: number;
  balance: number;
  sufficientFirstStep: boolean;
  sufficientAllSteps: boolean;
}

interface Preview {
  channel: OutreachChannel;
  matched: number;
  notVisible: number;
  willEnroll: number;
  skipped: {
    noEmail: number;
    malformedEmail: number;
    duplicateEmail: number;
    noPhone: number;
    foreignNumber: number;
    malformedPhone: number;
    duplicatePhone: number;
    suppressed: number;
    alreadyInSequence: number;
  };
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
  /** SMS sequences only: what the texts cost against the account's credits. */
  sms: SmsPreview | null;
  sampleNames: string[];
  sequence: { id: string; name: string; auto_send: boolean; channel?: OutreachChannel; send_window_text?: string | null };
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
  /** Ignored when `audiencePicker` is set — then the audience is whatever the picked filters match. */
  source?: BulkEnrollSource;
  /** Started from a sequence (not from ticked rows): show the filter bar so the rep chooses who. */
  audiencePicker?: { industryId: string | null; isAdmin: boolean };
  /** e.g. "42 selected leads" */
  sourceLabel: string;
  presetSequenceId?: string;
  onFinished?: () => void;
}

function isFinal(status: Run["status"]) {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export function BulkEnrollDialog({
  open,
  onOpenChange,
  source,
  audiencePicker,
  sourceLabel,
  presetSequenceId,
  onFinished,
}: BulkEnrollDialogProps) {
  const { sequences, loading: sequencesLoading } = useSequences();
  const [sequenceId, setSequenceId] = useState(presetSequenceId ?? "");
  // "pick" = the searchable sequence list; started from a sequence (preset) it is skipped.
  const [step, setStep] = useState<"pick" | "preview">(presetSequenceId ? "preview" : "pick");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [policy, setPolicy] = useState<Policy>("skip");
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const finishedRef = useRef(false);
  const [pickerTree, setPickerTree] = useState<FilterTree | null>(null);

  // The audience actually used. With the picker it is the filter tree — but never an EMPTY one: an empty filter
  // means "every lead", which must be an explicit choice, not the starting state.
  const activeSource: BulkEnrollSource | null = audiencePicker
    ? pickerTree && pickerTree.conditions.length > 0
      ? { mode: "filter", tree: pickerTree }
      : null
    : (source ?? null);

  // reset whenever the dialog opens
  useEffect(() => {
    if (open) {
      setSequenceId(presetSequenceId ?? "");
      setStep(presetSequenceId ? "preview" : "pick");
      setPreview(null);
      setError(null);
      setConfirmText("");
      setPolicy("skip");
      setPickerTree(null);
      setRun(null);
      setRunId(null);
      setStarting(false);
      finishedRef.current = false;
    }
  }, [open, presetSequenceId]);

  const sourceKey = JSON.stringify(activeSource);

  // Preview whenever the sequence (or the source) changes — only before a run exists.
  useEffect(() => {
    if (!open || !sequenceId || runId || step !== "preview") return;
    if (!activeSource) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setError(null);
    setPreview(null);
    // the picker changes as the rep edits filters — wait for a pause; ticked rows are already final
    const delay = audiencePicker ? 600 : 0;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await fetch("/api/v1/outreach/bulk-enroll/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sequence_id: sequenceId,
              source: toApiSource(activeSource),
              conflict_policy: policy,
            }),
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
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sequenceId, sourceKey, runId, policy, step]);

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
    !!preview &&
    !starting &&
    !preview.overLimit &&
    preview.willEnroll > 0 &&
    (!needsConfirm || confirmText.trim().toUpperCase() === CONFIRM_WORD);

  const start = async () => {
    if (!preview || !activeSource) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/outreach/bulk-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence_id: sequenceId,
          source: toApiSource(activeSource),
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
    const res = await fetch(`/api/v1/outreach/bulk-enroll/${runId}/cancel`, {
      method: "POST",
    });
    if (res.ok) toast.success("Cancelling — leads already enrolled stay enrolled");
    else toast.error("Couldn't cancel");
  };

  const processed = run ? run.enrolled_count + run.failed_count : 0;
  const total = run?.total_count ?? preview?.willEnroll ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const items: CommandItem[] = sequences.map((s) => ({
    id: s.id,
    label: s.name,
    group: s.channel === "sms" ? "SMS" : "Email",
    sub: `${s.email_sequence_steps?.length ?? 0} ${(s.email_sequence_steps?.length ?? 0) === 1 ? "step" : "steps"} · ${
      s.auto_send ? "sends automatically" : s.channel === "sms" ? "you approve each text" : "you approve each email"
    }`,
    lead: (
      <span className="grid size-6 shrink-0 place-items-center rounded-[7px] text-ds-muted shadow-[inset_0_0_0_1px_var(--ds-border)]">
        {s.channel === "sms" ? <ChatTextIcon className="size-3.5" aria-hidden /> : <EnvelopeSimpleIcon className="size-3.5" aria-hidden />}
      </span>
    ),
  }));

  const chosenSequence = sequences.find((s) => s.id === sequenceId);
  const seqName = preview?.sequence.name ?? chosenSequence?.name ?? "Enroll in sequence";
  const isSmsSeq = (preview?.channel ?? chosenSequence?.channel) === "sms";
  const final = !!run && isFinal(run.status);
  const leadWord = (n: number) => (n === 1 ? "lead" : "leads");
  const primaryLabel = preview ? `Enroll ${preview.willEnroll.toLocaleString()} ${leadWord(preview.willEnroll)}` : "Enroll";
  const subLabel = !runId
    ? sourceLabel
    : !run || !final
      ? "enrolling"
      : run.status === "completed"
        ? "done"
        : run.status === "cancelled"
          ? "cancelled"
          : "stopped";

  // Step 1: the shared command list (same as Move stage / Assign). Closing it closes the whole flow.
  if (step === "pick" && !runId) {
    return (
      <CommandDialog
        open={open}
        onClose={() => onOpenChange(false)}
        title={`Enroll ${sourceLabel} in a sequence`}
        placeholder="Search sequences…"
        items={items}
        mode="single"
        primaryLabel={(chosen) => (chosen[0] ? `Preview “${chosen[0].label}”` : "Preview")}
        onSubmit={(ids) => {
          setSequenceId(ids[0]);
          setStep("preview");
          return false; // we advance in place; the list unmounts because the step changed
        }}
        emptyLabel={(q) => (sequencesLoading ? "Loading…" : `No sequences match “${q}”`)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={audiencePicker ? "lg" : "md"} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-ds-accent-soft text-ds-accent [&_svg]:size-[13px]">
              {isSmsSeq ? <ChatTextIcon aria-hidden /> : <EnvelopeSimpleIcon aria-hidden />}
            </span>
            <span className="truncate">{seqName}</span>
            <span className="shrink-0 font-normal text-ds-faint">· {subLabel}</span>
          </DialogTitle>
        </DialogHeader>

        {!runId && (
          <>
            {audiencePicker && (
              <div className="space-y-1.5">
                <Label>Which leads?</Label>
                <AudienceFilterPicker
                  industryId={audiencePicker.industryId}
                  isAdmin={audiencePicker.isAdmin}
                  onChange={setPickerTree}
                />
                {!activeSource && (
                  <p className="text-xs text-ds-faint">Add at least one filter to choose who gets this sequence.</p>
                )}
              </div>
            )}

            {previewLoading && (
              <p className="flex items-center gap-2 text-sm text-ds-muted">
                <CircleNotchIcon className="h-4 w-4 animate-spin" /> Checking who can be enrolled…
              </p>
            )}

            {preview && (
              <>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums">{preview.willEnroll.toLocaleString()}</span>
                    <span className="font-normal text-ds-muted">
                      of {preview.matched.toLocaleString()} {leadWord(preview.matched)} will be enrolled
                    </span>
                  </div>
                  {preview.sampleNames.length > 0 && (
                    <div className="text-[13px] font-normal text-ds-faint">e.g. {preview.sampleNames.join(", ")}</div>
                  )}
                  {preview.willSwitch > 0 && (
                    <p className="mt-1 text-xs font-normal text-ds-faint">
                      {preview.willSwitch.toLocaleString()} of them leave their current sequence and start this one.
                    </p>
                  )}
                  {preview.willQueue > 0 && (
                    <p className="mt-1 text-xs font-normal text-ds-faint">
                      {preview.willQueue.toLocaleString()} of them are queued — this sequence starts when their current one ends.
                    </p>
                  )}
                </div>
                <SkippedList preview={preview} />
                {preview.inOtherSequence > 0 && (
                  <PolicyChoice
                    count={preview.inOtherSequence}
                    value={policy}
                    onChange={setPolicy}
                    channelLabel={preview.channel === "sms" ? "SMS " : ""}
                  />
                )}
                {preview.willEnroll > 0 && preview.channel === "email" && (
                  <Note>
                    The daily send limit is {preview.cap.dailyCap.toLocaleString()} ({preview.cap.remaining.toLocaleString()} left today).
                    {preview.estimatedExtraDays > 0
                      ? ` First emails will take about ${preview.estimatedExtraDays + 1} days to go out.`
                      : " All first emails fit within today's limit."}
                  </Note>
                )}
                {preview.willEnroll > 0 && preview.channel === "sms" && preview.sms && <SmsCredits sms={preview.sms} />}
                {preview.sequence.send_window_text && (
                  <Note>
                    This sequence sends {preview.sequence.send_window_text} (see its settings) — the first{" "}
                    {preview.channel === "sms" ? "texts" : "emails"} wait for that window too.
                  </Note>
                )}
                {preview.channel === "sms" && (
                  <Note>Texts are never sent during your SMS quiet hours, and every text carries your opt-out link.</Note>
                )}
                {preview.sequence.auto_send && (
                  <Warning>
                    This sequence sends automatically — nobody reviews the {preview.channel === "sms" ? "texts" : "emails"} before they go out.
                  </Warning>
                )}
                {!preview.sandbox && preview.sequence.auto_send && (
                  <Warning>
                    {preview.channel === "sms" ? "Texts go to the real leads, not a test number." : "Emails go to the real leads, not a test address."}
                  </Warning>
                )}
                {!preview.sendingEnabled && preview.sequence.auto_send && (
                  <Warning>
                    {preview.channel === "sms"
                      ? "SMS is turned off for this account, so the texts will wait."
                      : "Sending from EdgeX is turned off for this account, so the emails will wait."}
                  </Warning>
                )}
                {preview.overLimit && (
                  <Warning>
                    That is more than the {preview.limit.toLocaleString()} leads one run can enroll — narrow the selection.
                  </Warning>
                )}
              </>
            )}

            {needsConfirm && !preview?.overLimit && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-confirm" className="text-[13px] font-medium text-ds-muted">
                  Type{" "}
                  <span className="rounded bg-ds-hover px-1.5 py-px font-mono text-xs text-ds-ink">{CONFIRM_WORD}</span> to start{" "}
                  {preview?.willEnroll.toLocaleString()} enrollments
                </Label>
                <Input
                  id="bulk-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canStart) {
                      e.preventDefault();
                      void start();
                    }
                  }}
                  placeholder={CONFIRM_WORD}
                  autoComplete="off"
                  className="h-[34px] rounded-lg"
                />
              </div>
            )}

            {error && <p className="text-[13px] font-normal text-ds-bad">{error}</p>}
          </>
        )}

        {runId && (
          <>
            {run && final ? (
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full",
                    run.status === "completed" ? "bg-ds-good-soft text-ds-good" : "bg-ds-bad-soft text-ds-bad",
                  )}
                >
                  {run.status === "completed" ? <CheckIcon className="size-[18px]" /> : <WarningIcon className="size-[18px]" />}
                </span>
                <div>
                  <h3 className="m-0 mb-1 text-[15px] font-semibold">
                    {run.status === "completed" && `${run.enrolled_count.toLocaleString()} ${leadWord(run.enrolled_count)} enrolled`}
                    {run.status === "cancelled" && "Cancelled."}
                    {run.status === "failed" && "Stopped."}
                  </h3>
                  <p className="m-0 text-sm font-normal leading-[21px] text-ds-text">
                    {run.status === "completed" &&
                      (run.skipped_count > 0
                        ? `${run.skipped_count.toLocaleString()} were skipped.`
                        : "Nobody was skipped.")}
                    {run.status === "cancelled" && "Leads already enrolled stay enrolled."}
                    {run.status === "failed" && (run.error ?? "Something went wrong.")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <CircleNotchIcon className="size-3.5 animate-spin text-ds-accent" />
                  <span>
                    Enrolling {processed.toLocaleString()} of {total.toLocaleString()}…
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded bg-ds-sunken">
                  <div className="h-full rounded bg-ds-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
              </>
            )}
            {run && (
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Enrolled" value={run.enrolled_count} good />
                <Stat label="Skipped" value={run.skipped_count} />
                <Stat label="Failed" value={run.failed_count} />
              </div>
            )}
            {run && (run.queued_count ?? 0) > 0 && (
              <p className="text-xs font-normal text-ds-faint">
                Queued next {run.queued_count!.toLocaleString()} (included in skipped)
              </p>
            )}
            {(!run || !final) && (
              <p className="text-xs font-normal text-ds-faint">
                You can close this. Enrolling carries on in the background, and the result is in Outreach → Enrollments.
              </p>
            )}
          </>
        )}

        <DialogFooter>
          {!runId ? (
            <>
              {!presetSequenceId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep("pick");
                    setPreview(null);
                    setConfirmText("");
                    setError(null);
                  }}
                >
                  <ArrowLeftIcon className="size-3.5" /> Back
                </Button>
              )}
              <span className="hidden flex-1 sm:block" />
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={start} disabled={!canStart}>
                {starting && <CircleNotchIcon className="size-4 animate-spin" />}
                {primaryLabel}
                <DialogKeyHint>↵</DialogKeyHint>
              </Button>
            </>
          ) : run && final ? (
            <>
              {(run.skipped_count > 0 || run.failed_count > 0) && (
                <a href={`/api/v1/outreach/bulk-enroll/${runId}/skipped`} className={OUTLINE_BTN}>
                  <DownloadIcon className="size-4" /> Download skipped ({(run.skipped_count + run.failed_count).toLocaleString()})
                </a>
              )}
              <span className="hidden flex-1 sm:block" />
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={cancel}
                disabled={run?.cancel_requested}
                className="inline-flex h-8 items-center rounded-[9px] px-2.5 text-sm font-medium text-ds-bad hover:bg-ds-bad-soft disabled:opacity-50"
              >
                {run?.cancel_requested ? "Stopping…" : "Stop enrolling"}
              </button>
              <span className="hidden flex-1 sm:block" />
              <button type="button" onClick={() => onOpenChange(false)} className={OUTLINE_BTN}>
                Close
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTLINE_BTN =
  "inline-flex h-8 items-center gap-2 rounded-[9px] px-2.5 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] hover:bg-ds-hover";

function Stat({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <div className="rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--ds-border)]">
      <div className="text-xs font-normal text-ds-faint">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", good && "text-ds-good")}>{value.toLocaleString()}</div>
    </div>
  );
}

const POLICY_OPTIONS: { value: Policy; label: string; hint: string }[] = [
  {
    value: "skip",
    label: "Skip them",
    hint: "Leave them in their current sequence.",
  },
  {
    value: "switch",
    label: "Switch them",
    hint: "End their current sequence now and start this one.",
  },
  {
    value: "queue",
    label: "Queue next",
    hint: "Start this one automatically when their current sequence ends.",
  },
];

function PolicyChoice({
  count,
  value,
  onChange,
  channelLabel = "",
}: {
  count: number;
  value: Policy;
  onChange: (p: Policy) => void;
  channelLabel?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-ds-muted">
        {count.toLocaleString()} {count === 1 ? "lead is" : "leads are"} already in another {channelLabel}sequence
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {POLICY_OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-[10px] px-3 py-2.5 text-sm",
                on ? "bg-ds-accent-soft shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" : "shadow-[inset_0_0_0_1px_var(--ds-border)]",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="bulk-policy"
                  className="size-3.5 accent-[var(--ds-accent)]"
                  checked={on}
                  onChange={() => onChange(o.value)}
                />
                {o.label}
              </span>
              <span className="mt-0.5 block text-xs font-normal leading-4 text-ds-faint">{o.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SkippedList({ preview }: { preview: Preview }) {
  const isSms = preview.channel === "sms";
  const rows: [string, number][] = isSms
    ? [
        ["Already in an SMS sequence", preview.skipped.alreadyInSequence],
        ["No phone number", preview.skipped.noPhone],
        ["Not a Nepal mobile number", preview.skipped.foreignNumber],
        ["Invalid phone number", preview.skipped.malformedPhone],
        ["Opted out of SMS", preview.skipped.suppressed],
        ["Same number as another lead", preview.skipped.duplicatePhone],
        ["Not visible to you / not found", preview.notVisible],
      ]
    : [
        ["Already in a sequence", preview.skipped.alreadyInSequence],
        ["No email address", preview.skipped.noEmail],
        ["Invalid email address", preview.skipped.malformedEmail],
        ["Unsubscribed or bounced", preview.skipped.suppressed],
        ["Same email as another lead", preview.skipped.duplicateEmail],
        ["Not visible to you / not found", preview.notVisible],
      ];
  const shown = rows.filter(([, n]) => n > 0);
  if (shown.length === 0) return null;
  const total = shown.reduce((sum, [, n]) => sum + n, 0);
  return (
    <div className="overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_var(--ds-border)]">
      <div className="flex h-[30px] items-center bg-ds-canvas px-3 text-xs text-ds-muted">Skipped · {total.toLocaleString()}</div>
      {shown.map(([label, n]) => (
        <div key={label} className="flex h-[34px] items-center border-t border-ds-divider px-3 font-normal text-ds-text">
          {label}
          <span className="ml-auto font-medium tabular-nums text-ds-ink">{n.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function SmsCredits({ sms }: { sms: SmsPreview }) {
  return (
    <>
      <Note>
        The first texts need about <b>{sms.creditsFirstStep.toLocaleString()}</b> credits
        {sms.stepCount > 1 && <> ({sms.creditsAllSteps.toLocaleString()} for all {sms.stepCount} steps)</>}. You have{" "}
        {sms.balance.toLocaleString()}.
      </Note>
      {!sms.sufficientFirstStep && (
        <Warning>
          You don&apos;t have enough credits for the first texts. They will wait until credits are added — nothing is sent
          without credits.
        </Warning>
      )}
      {sms.sufficientFirstStep && !sms.sufficientAllSteps && (
        <Warning>
          Your credits cover the first texts but not the whole sequence. Later steps will wait if the balance runs out.
        </Warning>
      )}
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-ds-hover px-3 py-2.5 text-[13px] font-normal leading-[18px] text-ds-text">
      <InfoIcon className="mt-px size-4 shrink-0 text-ds-muted" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-ds-warn-soft px-3 py-2.5 text-[13px] font-normal leading-[18px] text-ds-warn">
      <WarningIcon className="mt-px size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function toApiSource(source: BulkEnrollSource) {
  return source.mode === "selected"
    ? { mode: "selected", lead_ids: source.leadIds }
    : { mode: "filter", tree: source.tree };
}

function extractError(json: unknown): string | null {
  const j = json as {
    error?: { message?: string; details?: Record<string, string[]> };
  } | null;
  const details = j?.error?.details;
  if (details) {
    const first = Object.values(details).flat()[0];
    if (first) return first;
  }
  return j?.error?.message ?? null;
}
