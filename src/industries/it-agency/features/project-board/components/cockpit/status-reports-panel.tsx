"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

interface StatusReportsPanelProps {
  reports: ProjectStatusReport[];
  loading: boolean;
  isAdmin: boolean;
  onCreateDraft: (summary: string) => Promise<boolean>;
  onPublish: (id: string) => Promise<boolean>;
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
  projectId,
  project,
  events,
  previewEnabled,
}: StatusReportsPanelProps) {
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);

  async function handleSaveDraft() {
    setSubmitting(true);
    const ok = await onCreateDraft(summary.trim());
    setSubmitting(false);
    if (ok) setSummary("");
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
          <div className="space-y-2">
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What's the human-readable update for this period?"
              rows={3}
              disabled={submitting}
            />
            <Button size="sm" onClick={handleSaveDraft} disabled={submitting || summary.trim().length === 0}>
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
            {r.summary && <p className="text-sm text-foreground">{r.summary}</p>}
          </div>
        ))}

        {published.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{r.summary}</p>
              <p className="text-xs text-muted-foreground">
                Published {r.published_at ? new Date(r.published_at).toLocaleDateString() : ""} ·{" "}
                {r.health_snapshot && HEALTH_LABEL[r.health_snapshot]} · {r.pct_complete_snapshot}% complete ·{" "}
                {formatSnapshotHours(r.hours_actual_snapshot)}h / {formatSnapshotHours(r.hours_estimate_snapshot)}h
              </p>
            </div>
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
    </>
  );
}
