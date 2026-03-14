"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { PipelineLead, PipelineStage } from "@/types/database";
import { LeadCard } from "./LeadCard";

interface PipelineColumnProps {
  stage: PipelineStage;
  leads: PipelineLead[];
  canDragLead: (lead: PipelineLead) => boolean;
}

export function PipelineColumn({ stage, leads, canDragLead }: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  return (
    <div className="flex flex-col w-72 min-w-72 shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 pb-2">
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <h3 className="text-sm font-semibold truncate">{stage.name}</h3>
        <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto space-y-2 p-1 rounded-lg border border-dashed transition-colors min-h-32 ${
          isOver ? "border-primary bg-primary/5" : "border-transparent"
        }`}
      >
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              disabled={!canDragLead(lead)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
