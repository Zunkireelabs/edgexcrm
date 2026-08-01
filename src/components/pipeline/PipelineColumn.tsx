"use client";

import { useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { PipelineLead, PipelineStage } from "@/types/database";
import { LeadCard } from "./LeadCard";
import { Inbox, Loader2 } from "lucide-react";

interface PipelineColumnProps {
  stage: PipelineStage;
  leads: PipelineLead[];
  canDragLead: (lead: PipelineLead) => boolean;
  pipelineId?: string;
  onMovedToPipeline?: (leadId: string) => void;
  /** True count of leads matching this column's filters (KANBAN-PAGINATION-BRIEF §3.3) —
   * always the header/footer number, never `leads.length` (that's just what's loaded). */
  total?: number;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

function calculateAvgDaysInStage(leads: PipelineLead[]): number {
  if (leads.length === 0) return 0;
  const totalDays = leads.reduce((sum, lead) => {
    const diff = Date.now() - new Date(lead.updated_at).getTime();
    return sum + Math.floor(diff / (1000 * 60 * 60 * 24));
  }, 0);
  return Math.round((totalDays / leads.length) * 10) / 10;
}

export function PipelineColumn({
  stage,
  leads,
  canDragLead,
  pipelineId,
  onMovedToPipeline,
  total,
  isLoadingMore = false,
  onLoadMore,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  const avgDays = calculateAvgDaysInStage(leads);
  // Fall back to leads.length when no total was supplied (e.g. tests / callers that
  // still pass a fully-loaded array) so this stays a drop-in-compatible prop.
  const trueTotal = total ?? leads.length;
  const remaining = Math.max(0, trueTotal - leads.length);

  // Phase 2 (infinite scroll): a sentinel at the bottom of THIS column's own scroll
  // container (not the viewport — the board scrolls horizontally, each column
  // vertically) triggers the next page automatically. The Load-more button above stays
  // as the fallback for browsers without IntersectionObserver or a failed auto-load.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const setScrollContainerRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    scrollContainerRef.current = node;
  };

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return; // no observer -> button-only fallback
    if (!onLoadMore || remaining <= 0 || isLoadingMore) return;
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root, rootMargin: "150px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, remaining, isLoadingMore]);

  return (
    <div className="flex flex-col w-80 min-w-80 shrink-0 h-full">
      {/* Column Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0">
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <h3 className="text-sm font-semibold truncate flex-1">{stage.name}</h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 font-medium">
          {trueTotal}
        </span>
      </div>

      {/* Header Divider */}
      <div className="h-px bg-border" />

      {/* Droppable Area */}
      <div
        ref={setScrollContainerRef}
        className={`flex-1 overflow-y-auto space-y-3 p-2 border border-t-0 bg-muted/20 transition-colors min-h-40 ${
          isOver ? "border-primary bg-primary/5" : "border-border/50"
        }`}
      >
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.length > 0 ? (
            leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                disabled={!canDragLead(lead)}
                pipelineId={pipelineId}
                onMovedToPipeline={onMovedToPipeline}
              />
            ))
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-2">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">No leads</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Drag leads here to update
              </p>
            </div>
          )}
        </SortableContext>

        {isLoadingMore && (
          /* Visible loading row — distinct from the button's own inline spinner, so an
             auto-triggered (sentinel) load is visible even though no button was clicked. */
          <div className="flex items-center justify-center gap-1.5 h-10 rounded-lg border border-dashed border-gray-200 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading more…
          </div>
        )}

        {remaining > 0 && onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-medium rounded-md border border-dashed border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoadingMore ? "Loading…" : `Load 20 more (${remaining.toLocaleString()} remaining)`}
          </button>
        )}

        {/* IntersectionObserver sentinel — invisible, triggers the next page
            automatically when scrolled near. Rendered only while more pages remain. */}
        {remaining > 0 && onLoadMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
      </div>

      {/* Column Footer */}
      <div className="px-3 py-2 bg-card rounded-b-lg border border-t-0 space-y-0.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium">{trueTotal} lead{trueTotal !== 1 ? "s" : ""}</span>
        </div>
        {leads.length > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Avg. time</span>
            <span className="font-medium">{avgDays} day{avgDays !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
