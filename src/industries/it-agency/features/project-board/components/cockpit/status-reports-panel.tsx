"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send, Sparkles, Share2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PreviewPill } from "./preview-pill";
import { useProjectIssues } from "../../hooks/use-project-issues";
import { useProjectChangeRequests } from "../../hooks/use-project-change-requests";
import type { Project, ProjectEvent, ProjectStatusReport } from "@/types/database";

const HEALTH_LABEL: Record<string, string> = { green: "On track", amber: "At risk", red: "Off track" };

/** hours_actual_snapshot / hours_estimate_snapshot store MINUTES (column
 * names are a historical no-migration holdover) — divide by 60 to display. */
function formatSnapshotHours(minutes: number | null): string {
  if (minutes == null) return "—";
  return (minutes / 60).toFixed(1);
}

// SAMPLE PREVIEW COPY — replaced by real AI output when the assistant lands.
const SAMPLE_DRAFT = {
  accomplishments:
    "Completed the discovery workshop and signed off on the information architecture; backend API scaffolding for listings search is in code review.",
  inProgress:
    "Agent dashboard UI is roughly 60% built; integrating the search index with the new filters is the current focus this sprint.",
  risks:
    "The client's content team hasn't delivered final property photography yet — this could slip the frontend polish milestone by a few days if it isn't in hand by Friday.",
  asks: "Please confirm the final list of supported property types by end of week so we can lock the listing schema.",
  clientMessage:
    "Hi team — good progress this week: the IA is signed off and the listings API is nearly through review. The one thing we need from you is the final property-type list by Friday to avoid a small schedule risk on the frontend.",
};

function DraftSection({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-foreground">{label}</p>
      <p className="text-sm text-muted-foreground mt-0.5">{text}</p>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label} </span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

/** The honest, non-AI half of the preview: real signals the (not-yet-built)
 * assistant would read. Only mounted while the sheet is open, so the
 * (already-existing) issues/CRs endpoints aren't hit for tenants that never
 * open this panel. */
function AiReadSignals({
  projectId,
  project,
  eventsSinceLastReport,
}: {
  projectId: string;
  project: Project;
  eventsSinceLastReport: number;
}) {
  const { issues, loading: issuesLoading } = useProjectIssues(projectId);
  const { changeRequests, loading: crLoading } = useProjectChangeRequests(projectId);
  const openIssues = issues.filter((i) => i.status === "open" || i.status === "in_progress").length;
  const openCRs = changeRequests.filter((cr) => cr.status === "proposed").length;
  const healthLabel = project.health ? HEALTH_LABEL[project.health] : "—";

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/20">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        What the AI will read
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Signal label="Health" value={healthLabel} />
        <Signal label="Complete" value={`${project.pct_complete ?? 0}%`} />
        <Signal label="Events since last report" value={String(eventsSinceLastReport)} />
        <Signal label="Open issues" value={issuesLoading ? "…" : String(openIssues)} />
        <Signal label="Open change requests" value={crLoading ? "…" : String(openCRs)} />
      </div>
    </div>
  );
}

function ShareDialog({
  report,
  open,
  onClose,
  onUpdated,
}: {
  report: ProjectStatusReport;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  const publicUrl = report.public_token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "")}/reports/share/${report.public_token}`
    : null;

  async function patchReport(body: { is_client_visible?: boolean; regenerate_token?: boolean }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/status-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to update share settings");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update share settings");
    } finally {
      setSaving(false);
      setConfirmRegen(false);
    }
  }

  function copyUrl() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share status report</DialogTitle>
          <DialogDescription>
            Anyone with the link can view a read-only, branded version of this report. No login required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-start gap-3">
            <Checkbox
              id="report-public-toggle"
              checked={!!report.is_client_visible}
              disabled={saving}
              onCheckedChange={(checked) => patchReport({ is_client_visible: checked === true })}
              className="mt-0.5"
            />
            <Label htmlFor="report-public-toggle" className="text-sm font-medium cursor-pointer">
              Public link enabled
            </Label>
          </div>

          {report.is_client_visible && publicUrl && (
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Public URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{publicUrl}</code>
                <Button size="icon" variant="outline" className="shrink-0 h-8 w-8" onClick={copyUrl}>
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}

          {report.is_client_visible && (
            <div className="border-t pt-4">
              {!confirmRegen ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => setConfirmRegen(true)}
                  disabled={saving}
                >
                  Regenerate link
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-destructive">This will break the existing URL. Are you sure?</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={saving} onClick={() => patchReport({ regenerate_token: true })}>
                      Yes, regenerate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DraftFields {
  accomplishments?: string;
  in_progress?: string;
  risks?: string;
  asks?: string;
  client_message?: string;
}

const SECTION_FIELDS: { key: keyof DraftFields; label: string }[] = [
  { key: "accomplishments", label: "Accomplishments" },
  { key: "in_progress", label: "In progress" },
  { key: "risks", label: "Risks" },
  { key: "asks", label: "Asks" },
  { key: "client_message", label: "Recommended client message" },
];

function ReportSections({ report }: { report: ProjectStatusReport }) {
  const sections = SECTION_FIELDS.filter((f) => report[f.key]);
  if (sections.length === 0) {
    if (!report.summary) return null;
    return <p className="text-sm text-foreground">{report.summary}</p>;
  }
  return (
    <div className="space-y-2">
      {sections.map((f) => (
        <DraftSection key={f.key} label={f.label} text={report[f.key] as string} />
      ))}
    </div>
  );
}

interface StatusReportsPanelProps {
  reports: ProjectStatusReport[];
  loading: boolean;
  isAdmin: boolean;
  onCreateDraft: (fields: DraftFields) => Promise<boolean>;
  onPublish: (id: string) => Promise<boolean>;
  onRefetch: () => void;
  // AI-synth vision preview (lib/ai-preview.ts) — Zunkiree dogfood + admin only.
  projectId: string;
  project: Project;
  events: ProjectEvent[];
  previewEnabled: boolean;
}

export function StatusReportsPanel({
  reports,
  loading,
  isAdmin,
  onCreateDraft,
  onPublish,
  onRefetch,
  projectId,
  project,
  events,
  previewEnabled,
}: StatusReportsPanelProps) {
  const [fields, setFields] = useState({
    accomplishments: "",
    inProgress: "",
    risks: "",
    asks: "",
    clientMessage: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);
  const [shareReportId, setShareReportId] = useState<string | null>(null);
  // Derived from `reports` (not copied into state) so a refetch after
  // toggling/regenerating keeps the open dialog showing the live token.
  const shareReport = shareReportId ? reports.find((r) => r.id === shareReportId) ?? null : null;

  function updateField(key: keyof typeof fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  const allFieldsEmpty = Object.values(fields).every((v) => v.trim().length === 0);

  async function handleSaveDraft() {
    setSubmitting(true);
    const ok = await onCreateDraft({
      accomplishments: fields.accomplishments.trim() || undefined,
      in_progress: fields.inProgress.trim() || undefined,
      risks: fields.risks.trim() || undefined,
      asks: fields.asks.trim() || undefined,
      client_message: fields.clientMessage.trim() || undefined,
    });
    setSubmitting(false);
    if (ok) setFields({ accomplishments: "", inProgress: "", risks: "", asks: "", clientMessage: "" });
  }

  const drafts = reports.filter((r) => !r.published_at);
  const published = reports.filter((r) => r.published_at);

  const lastPublishedAt = published.reduce<string | null>((latest, r) => {
    if (!r.published_at) return latest;
    if (!latest || r.published_at > latest) return r.published_at;
    return latest;
  }, null);
  const eventsSinceLastReport = lastPublishedAt
    ? events.filter((e) => e.occurred_at > lastPublishedAt).length
    : events.length;

  const sortedPublished = [...published].sort((a, b) =>
    (b.published_at ?? "").localeCompare(a.published_at ?? "")
  );
  const [latestPublished, priorPublished] = sortedPublished;
  const periodDiff = !priorPublished
    ? null
    : {
        healthFrom: priorPublished.health_snapshot,
        healthTo: latestPublished.health_snapshot,
        pctFrom: priorPublished.pct_complete_snapshot,
        pctTo: latestPublished.pct_complete_snapshot,
        hoursFrom: priorPublished.hours_actual_snapshot,
        hoursTo: latestPublished.hours_actual_snapshot,
      };

  return (
    <>
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-2">
        <div>
          <CardTitle className="text-sm">Status reports</CardTitle>
          <CardDescription>
            Publishing freezes the current health, % complete, and hours as a snapshot.
          </CardDescription>
        </div>
        {previewEnabled && (
          <div className="flex items-center gap-2 shrink-0">
            <PreviewPill />
            <Button variant="outline" size="sm" onClick={() => setAiPreviewOpen(true)}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Draft with AI
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <div className="space-y-3">
            <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              <span>
                {eventsSinceLastReport} new event{eventsSinceLastReport === 1 ? "" : "s"} since{" "}
                {lastPublishedAt ? new Date(lastPublishedAt).toLocaleDateString() : "the start"}
              </span>
              {periodDiff ? (
                <span className="ml-2">
                  · Health {periodDiff.healthFrom ? HEALTH_LABEL[periodDiff.healthFrom] : "—"} →{" "}
                  {periodDiff.healthTo ? HEALTH_LABEL[periodDiff.healthTo] : "—"} · Complete{" "}
                  {periodDiff.pctFrom ?? 0}% → {periodDiff.pctTo ?? 0}% · Hours{" "}
                  {formatSnapshotHours(periodDiff.hoursFrom)}h → {formatSnapshotHours(periodDiff.hoursTo)}h
                </span>
              ) : (
                <span className="ml-2 italic">First report</span>
              )}
            </div>

            <Textarea
              value={fields.accomplishments}
              onChange={(e) => updateField("accomplishments", e.target.value)}
              placeholder="Accomplishments"
              rows={2}
              disabled={submitting}
            />
            <Textarea
              value={fields.inProgress}
              onChange={(e) => updateField("inProgress", e.target.value)}
              placeholder="In progress"
              rows={2}
              disabled={submitting}
            />
            <Textarea
              value={fields.risks}
              onChange={(e) => updateField("risks", e.target.value)}
              placeholder="Risks"
              rows={2}
              disabled={submitting}
            />
            <Textarea
              value={fields.asks}
              onChange={(e) => updateField("asks", e.target.value)}
              placeholder="Asks"
              rows={2}
              disabled={submitting}
            />
            <Textarea
              value={fields.clientMessage}
              onChange={(e) => updateField("clientMessage", e.target.value)}
              placeholder="Recommended client message"
              rows={2}
              disabled={submitting}
            />
            <Button size="sm" onClick={handleSaveDraft} disabled={submitting || allFieldsEmpty}>
              Save draft
            </Button>
          </div>
        )}

        {!loading && drafts.length === 0 && published.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No status reports yet.</p>
        )}

        {drafts.map((r) => (
          <div key={r.id} className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Draft · {r.report_date}</span>
              {isAdmin && (
                <Button size="sm" onClick={() => onPublish(r.id)}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Publish
                </Button>
              )}
            </div>
            <ReportSections report={r} />
          </div>
        ))}

        {published.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
            <div className="min-w-0 space-y-2">
              <ReportSections report={r} />
              <p className="text-xs text-muted-foreground">
                Published {r.published_at ? new Date(r.published_at).toLocaleDateString() : ""} ·{" "}
                {r.health_snapshot && HEALTH_LABEL[r.health_snapshot]} · {r.pct_complete_snapshot}% complete ·{" "}
                {formatSnapshotHours(r.hours_actual_snapshot)}h / {formatSnapshotHours(r.hours_estimate_snapshot)}h
              </p>
            </div>
            {isAdmin && (
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShareReportId(r.id)}>
                <Share2 className="h-3.5 w-3.5 mr-1.5" />
                Share
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>

    {previewEnabled && (
      <Sheet open={aiPreviewOpen} onOpenChange={setAiPreviewOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              AI-drafted status report
              <PreviewPill />
            </SheetTitle>
            <SheetDescription>Sample preview — AI drafting is not yet live.</SheetDescription>
          </SheetHeader>
          {aiPreviewOpen && (
            <div className="space-y-5 px-4 pb-4">
              <AiReadSignals
                projectId={projectId}
                project={project}
                eventsSinceLastReport={eventsSinceLastReport}
              />

              <div className="space-y-3 rounded-md border border-dashed p-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Sample preview — AI drafting is not yet live
                </p>
                <DraftSection label="Accomplishments" text={SAMPLE_DRAFT.accomplishments} />
                <DraftSection label="In progress" text={SAMPLE_DRAFT.inProgress} />
                <DraftSection label="Risks" text={SAMPLE_DRAFT.risks} />
                <DraftSection label="Asks" text={SAMPLE_DRAFT.asks} />
                <DraftSection label="Recommended client message" text={SAMPLE_DRAFT.clientMessage} />
              </div>

              <div className="flex gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button size="sm" disabled>
                          Edit &amp; use draft
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      Coming soon — connects to the AI assistant.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button size="sm" variant="outline" disabled>
                          Regenerate
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      Coming soon — connects to the AI assistant.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    )}

    {shareReport && (
      <ShareDialog
        report={shareReport}
        open={!!shareReport}
        onClose={() => setShareReportId(null)}
        onUpdated={onRefetch}
      />
    )}
    </>
  );
}
