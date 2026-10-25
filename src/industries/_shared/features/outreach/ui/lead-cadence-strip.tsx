"use client";

import { useState, useEffect, useCallback } from "react";
import { Pause, Play, UserX, Loader2, GitBranch, Mail, MessageSquare, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSequences } from "../hooks/use-sequences";
import type { OutreachChannel } from "../lib/channel";
import { formatDate } from "../lib/format-due";
import { CadenceTimeline } from "./cadence-timeline";
import type { LeadSubscriptions } from "../lib/lead-subscriptions";

type EnrollmentStatus = "active" | "paused" | "completed" | "unenrolled";

interface Enrollment {
  id: string;
  sequence_id: string;
  status: EnrollmentStatus;
  current_step_order: number;
  assigned_to: string | null;
  // Set when the system stopped the enrollment because the lead replied (migration 257).
  stop_reason?: "replied" | "sequence_paused" | "suppressed" | "stage_left" | null;
  email_sequences: { name: string } | null;
  // Where it came from (migration 277): a stage auto-enroll rule starts the enrollment on its own.
  source?: "manual" | "bulk" | "stage_rule";
  /** The stage the lead entered, for a rule-started enrollment. Only the Subscribed tab's source knows it. */
  triggerStageName?: string | null;
}

interface DraftRow {
  lead_id: string;
  due_at: string;
  status: string;
}

interface LeadCadenceStripProps {
  leadId: string;
  isAdmin: boolean;
  currentUserId: string;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  leadEmail?: string | null;
  /**
   * Read the lead's running sequence from GET /api/v1/leads/[id]/subscriptions (the lead's own visibility rules) instead of the
   * outreach list, which only shows non-admins the enrollments assigned to them. Used by the Subscribed tab; the Emails tab keeps
   * the original source.
   */
  readFromLead?: boolean;
  /** Called after this strip enrolls / pauses / resumes / unenrolls, so a parent view can refresh too. */
  onChanged?: () => void;
  /**
   * Show each channel in its own titled box ("Email sequence" / "SMS sequence"), side by side on wide screens, with the picker on its
   * own line so nothing overflows. Used by the Subscribed tab; the Emails tab keeps the compact rows.
   */
  labelled?: boolean;
}

// A lead can run one EMAIL sequence and one SMS sequence at the same time (migration 274), so the strip shows one block per
// channel, each with its own enrollment, sequence picker, pause / resume / unenroll and timeline.
export function LeadCadenceStrip(props: LeadCadenceStripProps) {
  if (props.labelled) {
    return (
      <div className="flex flex-col gap-3 md:flex-row">
        <ChannelCadenceStrip channel="email" {...props} />
        <ChannelCadenceStrip channel="sms" {...props} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ChannelCadenceStrip channel="email" {...props} />
      <ChannelCadenceStrip channel="sms" {...props} />
    </div>
  );
}

function ChannelCadenceStrip({
  channel,
  leadId,
  isAdmin,
  currentUserId,
  leadFirstName = null,
  leadLastName = null,
  leadEmail = null,
  readFromLead = false,
  onChanged,
  labelled = false,
}: LeadCadenceStripProps & { channel: OutreachChannel }) {
  const isSms = channel === "sms";
  const { sequences } = useSequences(channel);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [nextDraftDueAt, setNextDraftDueAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [busy, setBusy] = useState(false);
  // Stage auto-enroll (migration 277): this channel is switched off for the lead, and the "stop an auto-enrolled sequence" confirm.
  const [autoEnrollOff, setAutoEnrollOff] = useState(false);
  const [confirmingUnenroll, setConfirmingUnenroll] = useState(false);
  const [alsoOptOut, setAlsoOptOut] = useState(false);

  const fetchEnrollment = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        readFromLead ? `/api/v1/leads/${leadId}/subscriptions` : `/api/v1/outreach/enrollments?lead_id=${leadId}&channel=${channel}`,
      );
      if (res.ok) {
        const json = await res.json();
        if (readFromLead) {
          const optOuts = (json.data as LeadSubscriptions | undefined)?.autoEnrollOptOuts;
          setAutoEnrollOff(channel === "sms" ? optOuts?.sms === true : optOuts?.email === true);
        }
        const rows: Enrollment[] = readFromLead
          ? ((json.data as LeadSubscriptions | undefined)?.sequences ?? [])
              .filter((r) => r.channel === channel)
              .map((r) => ({
                id: r.id,
                sequence_id: r.sequenceId,
                status: r.status,
                current_step_order: r.currentStep,
                assigned_to: r.assignedTo,
                stop_reason: r.stopReason,
                email_sequences: { name: r.sequenceName },
                source: r.source,
                triggerStageName: r.triggerStageName,
              }))
          : ((json.data ?? []) as Enrollment[]);
        const live = rows.find((r) => r.status === "active" || r.status === "paused");
        setEnrollment(live ?? null);

        if (live && live.status === "active") {
          // narrowed to THIS lead: the unfiltered list is capped at 1,000 rows and would miss the lead on a big tenant
          const draftsRes = await fetch(`/api/v1/outreach/drafts?due=all&lead_id=${leadId}&channel=${channel}`);
          if (draftsRes.ok) {
            const draftsJson = await draftsRes.json();
            const pending = (draftsJson.data ?? []) as DraftRow[];
            const mine = pending.find((d) => d.lead_id === leadId);
            setNextDraftDueAt(mine?.due_at ?? null);
          }
        } else {
          setNextDraftDueAt(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [leadId, channel, readFromLead]);

  useEffect(() => {
    fetchEnrollment();
  }, [fetchEnrollment]);

  const handleEnroll = async () => {
    if (!selectedSequenceId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/outreach/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence_id: selectedSequenceId, lead_id: leadId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409) toast.error(`Lead is already in ${isSms ? "an SMS" : "an email"} sequence`);
        else if (res.status === 404) toast.error(json?.error?.message ?? "Lead or sequence not found");
        else toast.error(json?.error?.message ?? "Failed to enroll lead");
        return;
      }
      toast.success("Lead enrolled");
      fetchEnrollment();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: "pause" | "resume" | "unenroll") => {
    if (!enrollment) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/outreach/enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to update enrollment");
        return;
      }
      toast.success(
        action === "pause" ? "Sequence paused" : action === "resume" ? "Sequence resumed" : "Lead unenrolled",
      );
      fetchEnrollment();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  // Unenrolling a sequence a RULE started asks one question first: should stage moves ever start another one for this lead?
  const confirmUnenroll = async () => {
    setConfirmingUnenroll(false);
    const optOut = alsoOptOut;
    setAlsoOptOut(false);
    await runAction("unenroll");
    if (optOut) await setOptOut("off");
  };

  const setOptOut = async (mode: "off" | "on") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/auto-enroll-optout`, {
        method: mode === "off" ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: [channel] }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to update auto-enroll for this lead");
        return;
      }
      setAutoEnrollOff(mode === "off");
      toast.success(mode === "off" ? "Auto-enroll is off for this lead" : "Auto-enroll is back on for this lead");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  const canManage = isAdmin || enrollment?.assigned_to === currentUserId;

  if (!enrollment) {
    // Don't nag accounts that have no SMS sequences: the SMS block only appears once there is one to join (or one running).
    if (isSms && sequences.length === 0) return null;
    if (labelled) {
      return (
        <ChannelBox channel={channel}>
          <p className="text-sm text-muted-foreground">Not running</p>
          {sequences.length === 0 ? (
            <p className="text-xs text-muted-foreground">No {isSms ? "SMS " : ""}sequences yet — create one in Outreach &rsaquo; Sequences.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedSequenceId} onValueChange={setSelectedSequenceId}>
                <SelectTrigger className="h-8 min-w-0 flex-1 basis-40" aria-label={isSms ? "Enroll in SMS sequence" : "Enroll in email sequence"}>
                  <SelectValue placeholder="Pick a sequence…" />
                </SelectTrigger>
                <SelectContent>
                  {sequences.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" disabled={!selectedSequenceId || busy} onClick={handleEnroll}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enroll"}
              </Button>
            </div>
          )}
          {autoEnrollOff && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
              <span>Auto-enroll by stage is off for this lead ({isSms ? "SMS" : "email"}).</span>
              {canManage && (
                <button type="button" disabled={busy} className="font-medium text-foreground underline underline-offset-2 disabled:opacity-50" onClick={() => setOptOut("on")}>
                  Turn back on
                </button>
              )}
            </div>
          )}
        </ChannelBox>
      );
    }
    if (sequences.length === 0) {
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground">
            No sequences yet — create one in Outreach &rsaquo; Sequences.
          </span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground shrink-0">{isSms ? "Not in an SMS sequence" : "Not in a sequence"}</span>
        <Select value={selectedSequenceId} onValueChange={setSelectedSequenceId}>
          <SelectTrigger className="h-8 w-56 ml-auto">
            <SelectValue placeholder={isSms ? "Enroll in SMS sequence..." : "Enroll in sequence..."} />
          </SelectTrigger>
          <SelectContent>
            {sequences.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" disabled={!selectedSequenceId || busy} onClick={handleEnroll}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enroll"}
        </Button>
      </div>
    );
  }

  const totalSteps = sequences.find((s) => s.id === enrollment.sequence_id)?.email_sequence_steps.length;
  const sequenceName = enrollment.email_sequences?.name ?? "Sequence";

  const running = (
    <div className="space-y-2">
      <div className="rounded-lg border bg-muted/30 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground shrink-0">{isSms ? "In SMS sequence:" : "In sequence:"}</span>
          <span className="text-sm font-medium truncate min-w-0 max-w-full">{sequenceName}</span>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {" · Step "}
            {enrollment.current_step_order}
            {totalSteps ? `/${totalSteps}` : ""}
            {nextDraftDueAt && ` · next draft ${formatDate(nextDraftDueAt)}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={enrollment.status === "active" ? "default" : "secondary"}>{enrollment.status}</Badge>
          {enrollment.source === "stage_rule" && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              title="Started automatically by a stage rule"
            >
              <Zap className="h-3 w-3" aria-hidden />
              Auto-enrolled{enrollment.triggerStageName ? ` · entered ${enrollment.triggerStageName}` : ""}
            </span>
          )}
          {enrollment.stop_reason === "replied" && (
            <span className="text-xs text-muted-foreground">
              {enrollment.status === "paused" ? "Paused — the lead replied. Resume or unenroll when you've followed up." : "Ended — the lead replied."}
            </span>
          )}

          {canManage && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  {enrollment.status === "active" ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => runAction("pause")}>
                      <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" onClick={() => runAction("resume")}>
                      <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => (enrollment.source === "stage_rule" ? setConfirmingUnenroll(true) : runAction("unenroll"))}
                  >
                    <UserX className="h-3.5 w-3.5 mr-1.5" /> Unenroll
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <CadenceTimeline
        enrollmentId={enrollment.id}
        enrollmentStatus={enrollment.status}
        leadId={leadId}
        leadFirstName={leadFirstName}
        leadLastName={leadLastName}
        leadEmail={leadEmail}
        sequenceName={sequenceName}
        canAct={canManage}
        isAdmin={isAdmin}
        onChanged={fetchEnrollment}
      />

      <AlertDialog
        open={confirmingUnenroll}
        onOpenChange={(open) => {
          setConfirmingUnenroll(open);
          if (!open) setAlsoOptOut(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unenroll from &ldquo;{sequenceName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {leadFirstName ?? "This lead"} won&apos;t get any more {isSms ? "texts" : "emails"} from this sequence. Steps not yet sent are cancelled.
              It started automatically, so it won&apos;t restart on its own.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox id={`optout-${channel}`} checked={alsoOptOut} onCheckedChange={(c) => setAlsoOptOut(c === true)} />
            <div className="space-y-0.5">
              <Label htmlFor={`optout-${channel}`} className="text-sm font-normal cursor-pointer">
                Also don&apos;t auto-enroll {leadFirstName ?? "this lead"} into other stages&apos; {isSms ? "SMS" : "email"} sequences
              </Label>
              <p className="text-xs text-muted-foreground">Stage moves won&apos;t start any automatic {isSms ? "SMS" : "email"} sequence for this lead. You can still enroll them by hand.</p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={confirmUnenroll}>
              Unenroll
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
  return labelled ? <ChannelBox channel={channel}>{running}</ChannelBox> : running;
}

/** The titled box of one channel in the labelled layout. */
function ChannelBox({ channel, children }: { channel: OutreachChannel; children: React.ReactNode }) {
  const isSms = channel === "sms";
  const Icon = isSms ? MessageSquare : Mail;
  return (
    <section className="min-w-0 flex-1 space-y-2 rounded-lg border bg-card p-3" aria-label={isSms ? "SMS sequence" : "Email sequence"}>
      <h5 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className={`h-4 w-4 ${isSms ? "text-emerald-600" : "text-blue-600"}`} />
        {isSms ? "SMS sequence" : "Email sequence"}
      </h5>
      {children}
    </section>
  );
}
