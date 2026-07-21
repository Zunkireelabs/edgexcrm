"use client";

import { useState, useEffect, useCallback } from "react";
import { Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DraftReviewPanel } from "./draft-review-panel";
import { formatRelativeDay } from "../lib/format-due";

export interface Draft {
  id: string;
  lead_id: string;
  step_order: number;
  due_at: string;
  subject: string;
  body_html: string;
  status: "pending" | "sent" | "skipped";
  leads: { first_name: string | null; last_name: string | null; email: string | null } | null;
  sequence_enrollments: {
    sequence_id: string;
    status: string;
    email_sequences: { name: string } | null;
  } | null;
}

export function TodayWorklist() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const fetchDrafts = useCallback(async (due: "today" | "all") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/outreach/drafts?due=${due}`);
      if (res.ok) {
        const json = await res.json();
        setDrafts(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts(showAll ? "all" : "today");
  }, [fetchDrafts, showAll]);

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setActiveDraft(null);
  };

  const todayCount = drafts.filter((d) => new Date(d.due_at) <= new Date()).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {showAll ? `${drafts.length} scheduled` : `${todayCount} due today`}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show due today" : "Show all scheduled"}
        </Button>
      </div>

      {loading ? (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center text-muted-foreground">Loading drafts...</CardContent>
        </Card>
      ) : drafts.length === 0 ? (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No drafts due. You&apos;re all caught up.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y rounded-lg border">
          {drafts.map((draft) => {
            const leadName =
              [draft.leads?.first_name, draft.leads?.last_name].filter(Boolean).join(" ") || "Unknown lead";
            const isDueYet = new Date(draft.due_at) <= new Date();
            return (
              <button
                key={draft.id}
                type="button"
                onClick={() => setActiveDraft(draft)}
                className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{leadName}</span>
                    <span className="text-xs text-muted-foreground truncate">{draft.leads?.email}</span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{draft.subject}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <Badge variant="secondary" className="whitespace-nowrap">
                    {draft.sequence_enrollments?.email_sequences?.name ?? "Sequence"} · Step {draft.step_order}
                  </Badge>
                  <Badge variant={isDueYet ? "default" : "outline"} className="whitespace-nowrap">
                    {formatRelativeDay(draft.due_at)}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DraftReviewPanel
        draft={activeDraft}
        onOpenChange={(open) => !open && setActiveDraft(null)}
        onSent={removeDraft}
        onSkipped={removeDraft}
      />
    </div>
  );
}
