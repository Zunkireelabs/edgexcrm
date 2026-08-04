"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Inbox } from "lucide-react";
import { ApplicationCard } from "./application-card";
import type { Application, ApplicationStage } from "@/types/database";

interface ApplicationColumnProps {
  stage: ApplicationStage;
  applications: Application[];
  canDrag: boolean;
  onOpenDetail?: (app: Application) => void;
  /** user_id -> display name, for resolving a card's assignee (matches PipelineColumn). */
  assigneeNames?: Record<string, string>;
}

export function ApplicationColumn({ stage, applications, canDrag, onOpenDetail, assigneeNames }: ApplicationColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex flex-col w-80 min-w-80 shrink-0 h-full rounded-lg bg-sidebar-bg">
      {/* Column Header — same background as the column body, no border/card box */}
      <div className="flex items-center gap-2 px-3 py-3 shrink-0">
        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
        <h3 className="text-sm font-semibold truncate flex-1">{stage.name}</h3>
        <span className="text-xs text-muted-foreground">
          {applications.length} {applications.length === 1 ? "application" : "applications"}
        </span>
      </div>

      {/* Droppable Area — cards float on the same column background, no separate box */}
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto space-y-2 px-2 pb-2 transition-colors min-h-40 rounded-lg ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        <SortableContext items={applications.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          {applications.length > 0 ? (
            applications.map((app) => (
              <ApplicationCard
                key={app.id}
                application={app}
                disabled={!canDrag}
                onOpenDetail={onOpenDetail}
                assigneeName={app.assigned_to ? assigneeNames?.[app.assigned_to] : undefined}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-2">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">No applications</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">Drag here</p>
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}
