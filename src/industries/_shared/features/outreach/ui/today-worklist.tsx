"use client";

import { useState, useEffect, useCallback } from "react";
import { Inbox, Send, CalendarClock, SkipForward } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DraftReviewPanel } from "./draft-review-panel";
import { BulkDraftDialog, type BulkDraftAction, type BulkDraftSelection } from "./bulk-draft-dialog";
import { formatRelativeDay } from "../lib/format-due";

export interface Draft {
  id: string;
  lead_id: string;
  step_order: number;
  due_at: string;
  subject: string;
  body_html: string;
  status: "pending" | "sent" | "skipped";
  draft_source: "template" | "ai";
  // Set when the rep scheduled an EdgeX send for this draft (Schedule send). `scheduled_error` explains
  // a scheduled send that did NOT go out.
  scheduled_send_at?: string | null;
  scheduled_error?: string | null;
  leads: { first_name: string | null; last_name: string | null; email: string | null } | null;
  sequence_enrollments: {
    sequence_id: string;
    status: string;
    email_sequences: { name: string } | null;
  } | null;
}

interface TodayWorklistProps {
  isAdmin: boolean;
}

const PAGE_SIZE = 50;

// The worklist is PAGED (50 at a time, with a true total) — a bulk enroll can leave thousands of drafts due, and one
// unpaged list was capped at 1,000 rows by the server and would have shown a wrong count. Rows can be ticked; ticking
// every row on the page offers "select all N matching", and the bulk bar then acts on ALL of them (the server resolves the
// same set the list shows). Send now / Schedule need EdgeX sending to be on (education); Skip is always available.
export function TodayWorklist({ isAdmin }: TodayWorklistProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkDraftAction | null>(null);
  const [capability, setCapability] = useState({ enabled: false, sandbox: true });

  const due = showAll ? "all" : "today";

  const fetchDrafts = useCallback(async (dueParam: "today" | "all", pageParam: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/outreach/drafts?due=${dueParam}&page=${pageParam}&pageSize=${PAGE_SIZE}`);
      if (res.ok) {
        const json = await res.json();
        setDrafts(json.data ?? []);
        setTotal(json.meta?.total ?? 0);
        setTotalPages(json.meta?.totalPages ?? 1);
        // a page past the end (after bulk skips emptied it) steps back to the last real one
        if ((json.data ?? []).length === 0 && pageParam > 1) setPage(Math.max(1, json.meta?.totalPages ?? 1));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts(due, page);
  }, [fetchDrafts, due, page]);

  // Can EdgeX send? Decides whether Send now / Schedule are offered, and whether the sandbox warning shows.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/outreach/send-capability")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) setCapability({ enabled: json.data.enabled === true, sandbox: json.data.sandbox !== false });
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  const clearSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };

  const changeFilter = () => {
    setShowAll((v) => !v);
    setPage(1);
    clearSelection();
  };

  const goToPage = (next: number) => {
    setPage(next);
    clearSelection();
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setActiveDraft(null);
    fetchDrafts(due, page); // the total and the page behind it move up
  };

  const updateDraft = (updated: Draft) => {
    setDrafts((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
    setActiveDraft((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  };

  const pageIds = drafts.map((d) => d.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = allMatching ? total : selected.size;

  const toggleOne = (id: string, checked: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setAllMatching(false);
    setSelected(checked ? new Set(pageIds) : new Set());
  };

  const bulkSelection: BulkDraftSelection = allMatching ? { mode: "all", due } : { mode: "ids", ids: [...selected] };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {showAll ? `${total.toLocaleString()} scheduled` : `${total.toLocaleString()} due today`}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={changeFilter}>
          {showAll ? "Show due today" : "Show all scheduled"}
        </Button>
      </div>

      {selectedCount > 0 && (
        <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2" role="region" aria-label="Bulk actions">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{selectedCount.toLocaleString()} selected</span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {capability.enabled && (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => setBulkAction("send")}>
                    <Send className="mr-1.5 h-3.5 w-3.5" /> Send now
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setBulkAction("schedule")}>
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Schedule…
                  </Button>
                </>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => setBulkAction("skip")}>
                <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Skip
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
          {allPageSelected && !allMatching && total > drafts.length && (
            <p className="text-xs text-muted-foreground">
              All {drafts.length} on this page are selected.{" "}
              <button type="button" className="font-medium text-primary underline" onClick={() => setAllMatching(true)}>
                Select all {total.toLocaleString()} {showAll ? "scheduled" : "due today"}
              </button>
            </p>
          )}
          {allMatching && (
            <p className="text-xs text-muted-foreground">
              All {total.toLocaleString()} {showAll ? "scheduled" : "due today"} are selected, across every page.
            </p>
          )}
        </div>
      )}

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
          <div className="flex items-center gap-3 bg-muted/20 px-4 py-2">
            <Checkbox checked={allPageSelected} onCheckedChange={(c) => togglePage(c === true)} aria-label="Select all on this page" />
            <span className="text-xs text-muted-foreground">Select this page</span>
          </div>
          {drafts.map((draft) => {
            const leadName =
              [draft.leads?.first_name, draft.leads?.last_name].filter(Boolean).join(" ") || "Unknown lead";
            const isDueYet = new Date(draft.due_at) <= new Date();
            return (
              <div key={draft.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                <Checkbox
                  checked={allMatching || selected.has(draft.id)}
                  onCheckedChange={(c) => toggleOne(draft.id, c === true)}
                  aria-label={`Select ${leadName}`}
                />
                <button
                  type="button"
                  onClick={() => setActiveDraft(draft)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
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
                    {draft.scheduled_send_at && (
                      <Badge variant="outline" className="whitespace-nowrap border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300">
                        Scheduled · {new Date(draft.scheduled_send_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </Badge>
                    )}
                    <Badge variant={isDueYet ? "default" : "outline"} className="whitespace-nowrap">
                      {formatRelativeDay(draft.due_at)}
                    </Badge>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages.toLocaleString()}
          </p>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              Previous
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <DraftReviewPanel
        draft={activeDraft}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setActiveDraft(null)}
        onSent={removeDraft}
        onSkipped={removeDraft}
        onUpdated={updateDraft}
      />

      {bulkAction && (
        <BulkDraftDialog
          open
          onOpenChange={(open) => !open && setBulkAction(null)}
          action={bulkAction}
          selection={bulkSelection}
          count={selectedCount}
          sandbox={capability.sandbox}
          onDone={() => {
            clearSelection();
            fetchDrafts(due, page);
          }}
        />
      )}
    </div>
  );
}
