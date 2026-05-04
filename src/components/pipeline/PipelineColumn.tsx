"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { PipelineLead, PipelineStage } from "@/types/database";
import { LeadCard } from "./LeadCard";
import { Inbox } from "lucide-react";

interface PipelineColumnProps {
  stage: PipelineStage;
  leads: PipelineLead[];
  canDragLead: (lead: PipelineLead) => boolean;
  pipelineId?: string;
  onMovedToPipeline?: (leadId: string) => void;
}

function calculateAvgDaysInStage(leads: PipelineLead[]): number {
  if (leads.length === 0) return 0;
  const totalDays = leads.reduce((sum, lead) => {
    const diff = Date.now() - new Date(lead.updated_at).getTime();
    return sum + Math.floor(diff / (1000 * 60 * 60 * 24));
  }, 0);
  return Math.round((totalDays / leads.length) * 10) / 10;
}

export function PipelineColumn({ stage, leads, canDragLead, pipelineId, onMovedToPipeline }: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  const avgDays = calculateAvgDaysInStage(leads);

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
          {leads.length}
        </span>
      </div>

      {/* Header Divider */}
      <div className="h-px bg-border" />

      {/* Droppable Area */}
      <div
        ref={setNodeRef}
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
      </div>

      {/* Column Footer */}
      <div className="px-3 py-2 bg-card rounded-b-lg border border-t-0 space-y-0.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium">{leads.length} lead{leads.length !== 1 ? "s" : ""}</span>
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
