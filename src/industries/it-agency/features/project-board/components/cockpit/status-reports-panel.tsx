"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { ProjectStatusReport } from "@/types/database";

const HEALTH_LABEL: Record<string, string> = { green: "On track", amber: "At risk", red: "Off track" };

interface StatusReportsPanelProps {
  reports: ProjectStatusReport[];
  loading: boolean;
  onCreateDraft: (summary: string) => Promise<boolean>;
  onPublish: (id: string) => Promise<boolean>;
}

export function StatusReportsPanel({ reports, loading, onCreateDraft, onPublish }: StatusReportsPanelProps) {
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSaveDraft() {
    setSubmitting(true);
    const ok = await onCreateDraft(summary.trim());
    setSubmitting(false);
    if (ok) setSummary("");
  }

  const drafts = reports.filter((r) => !r.published_at);
  const published = reports.filter((r) => r.published_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Status reports</CardTitle>
        <CardDescription>
          Publishing freezes the current health, % complete, and hours as a snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {!loading && drafts.length === 0 && published.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No status reports yet.</p>
        )}

        {drafts.map((r) => (
          <div key={r.id} className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Draft · {r.report_date}</span>
              <Button size="sm" onClick={() => onPublish(r.id)}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Publish
              </Button>
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
                {r.hours_actual_snapshot}h / {r.hours_estimate_snapshot}h
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
