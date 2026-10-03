"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SequenceReport } from "../lib/sequence-report";

// "How is this sequence doing?" — the numbers behind one sequence (lib/sequence-report.ts): who is in it, what happened
// to them, what the emails did, the step funnel and what is waiting to go out.

interface ReportResponse extends SequenceReport {
  sequence: { id: string; name: string; on_reply: "pause" | "end" | "continue" };
}

interface SequenceReportDialogProps {
  sequence: { id: string; name: string } | null;
  onClose: () => void;
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string | null }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const pctText = (p: number | null) => (p === null ? null : `${p}%`);

export function SequenceReportDialog({ sequence, onClose }: SequenceReportDialogProps) {
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sequence) return;
    let cancelled = false;
    setReport(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/v1/outreach/sequences/${sequence.id}/report`);
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setError(json?.error?.message ?? "Couldn't load the report");
        else setReport(json.data as ReportResponse);
      } catch {
        if (!cancelled) setError("Couldn't load the report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequence]);

  const maxStep = report ? Math.max(1, ...report.steps.map((s) => s.sent)) : 1;

  return (
    <Dialog open={!!sequence} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report — {sequence?.name}</DialogTitle>
          <DialogDescription>Counts across every lead that has been in this sequence.</DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Counting…
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {report && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Leads</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="In total" value={report.enrollments.total} />
                <Stat label="Running" value={report.enrollments.running} />
                <Stat label="Paused" value={report.enrollments.paused} hint={report.enrollments.pausedByStopAll > 0 ? `${report.enrollments.pausedByStopAll.toLocaleString()} by Pause all` : null} />
                <Stat label="Completed" value={report.enrollments.completed} />
                <Stat label="Ended early" value={report.enrollments.ended} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="Replied"
                  value={report.enrollments.replied}
                  hint={report.sequence.on_reply === "continue" ? "Not tracked: this sequence keeps sending after a reply" : pctText(report.rates.repliedPct)}
                />
                <Stat label="Do not contact (unsubscribed / bounced)" value={report.enrollments.doNotContact} />
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Emails</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Sent" value={report.emails.sent} />
                <Stat label="Delivered" value={report.emails.delivered} hint={pctText(report.rates.deliveredPct)} />
                <Stat label="Bounced" value={report.emails.bounced} hint={pctText(report.rates.bouncedPct)} />
                <Stat label="Spam complaints" value={report.emails.complained} hint={pctText(report.rates.complainedPct)} />
              </div>
              <p className="text-xs text-muted-foreground">
                &ldquo;Delivered&rdquo; counts only emails the mail provider has confirmed, so it can trail &ldquo;Sent&rdquo; for a while.
              </p>
            </section>

            {report.steps.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Emails sent at each step</h3>
                <ul className="space-y-1.5">
                  {report.steps.map((s) => (
                    <li key={s.stepOrder} className="flex items-center gap-3 text-sm">
                      <span className="w-14 shrink-0 text-muted-foreground">Step {s.stepOrder}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${Math.round((s.sent / maxStep) * 100)}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right tabular-nums">{s.sent.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Waiting to go out</h3>
              <p className="text-sm text-muted-foreground">
                {report.queue.dueNow.toLocaleString()} due now (waiting for the next pass or the daily limit) ·{" "}
                {report.queue.scheduledLater.toLocaleString()} scheduled for later
              </p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
