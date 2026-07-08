"use client";

import { useState } from "react";
import {
  FileText,
  ShieldCheck,
  ClipboardList,
  GitPullRequestArrow,
  CheckCircle2,
  XCircle,
  Scale,
  Milestone,
  AlertCircle,
  Send,
  Lightbulb,
  Circle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { ProjectEvent } from "@/types/database";

const EVENT_ICON: Record<string, typeof Circle> = {
  brief_captured: FileText,
  scope_baseline_set: ShieldCheck,
  plan_committed: ClipboardList,
  change_request_proposed: GitPullRequestArrow,
  change_request_approved: CheckCircle2,
  change_request_rejected: XCircle,
  task_reconciled: Scale,
  milestone_accepted: Milestone,
  issue_raised: AlertCircle,
  issue_resolved: CheckCircle2,
  status_published: Send,
  retro_lesson: Lightbulb,
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

interface TimelinePanelProps {
  events: ProjectEvent[];
  loading: boolean;
  onAddRetroLesson: (lesson: string) => Promise<boolean>;
}

export function TimelinePanel({ events, loading, onAddRetroLesson }: TimelinePanelProps) {
  const [adding, setAdding] = useState(false);
  const [lesson, setLesson] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    setSubmitting(true);
    const ok = await onAddRetroLesson(lesson.trim());
    setSubmitting(false);
    if (ok) {
      setLesson("");
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Institutional memory</CardTitle>
          <CardDescription>Every decision this project has made, in order.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Retro lesson
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <Textarea
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              placeholder="What should the next project like this one know?"
              rows={2}
              disabled={submitting}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={submitting || lesson.trim().length === 0}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!loading && events.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No decisions recorded yet.</p>
        )}

        <div className="space-y-3">
          {events.map((event) => {
            const Icon = EVENT_ICON[event.event_type] ?? Circle;
            return (
              <div key={event.id} className="flex items-start gap-3">
                <div className="mt-0.5 h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{event.summary ?? event.event_type}</p>
                  <p className="text-xs text-muted-foreground">{relativeTime(event.occurred_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
