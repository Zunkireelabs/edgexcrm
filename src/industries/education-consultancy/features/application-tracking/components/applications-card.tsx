"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Loader2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./status-badge";
import { AddApplicationToLeadSheet } from "./add-application-to-lead-sheet";
import type { Application, ApplicationStage } from "@/types/database";

interface ApplicationsCardProps {
  leadId: string;
  canManage: boolean;
  disabled?: boolean;
}

/** Inner card body — shared by the static and sortable variants. */
function ApplicationBody({
  app,
  stages,
  leadId,
}: {
  app: Application;
  stages: ApplicationStage[];
  leadId: string;
}) {
  const stage =
    (app.application_stages as ApplicationStage | null) ??
    stages.find((s) => s.id === app.stage_id) ??
    null;
  const intakeCountry = [app.intake_term, app.country].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/applications/${app.id}?from=lead&leadId=${leadId}`}
      className="block flex-1 min-w-0"
    >
      <p className="text-sm font-medium">{app.university_name}</p>
      {app.program_name && (
        <p className="text-sm text-muted-foreground mt-0.5">{app.program_name}</p>
      )}
      {intakeCountry && (
        <p className="text-xs text-muted-foreground mt-0.5">{intakeCountry}</p>
      )}
      {(stage || app.application_deadline) && (
        <div className="flex items-center gap-2 mt-1.5">
          {stage && (
            <StatusBadge
              slug={stage.slug}
              name={stage.name}
              color={stage.color}
              terminalType={stage.terminal_type}
            />
          )}
          {app.application_deadline && (
            <span className="text-xs text-muted-foreground">
              {new Date(app.application_deadline).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

/** Draggable row — drag via the grip handle so the card body stays clickable. */
function SortableApplicationRow({
  app,
  stages,
  leadId,
}: {
  app: Application;
  stages: ApplicationStage[];
  leadId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: app.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-1.5 border rounded-md p-3 transition-colors ${
        isDragging ? "shadow-lg ring-2 ring-primary/20 border-primary/30 bg-background" : "hover:bg-muted/30"
      }`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 text-muted-foreground/40 hover:text-muted-foreground shrink-0 mt-0.5"
        onClick={(e) => e.preventDefault()}
        aria-label="Reorder application"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ApplicationBody app={app} stages={stages} leadId={leadId} />
    </div>
  );
}

export function ApplicationsCard({ leadId, canManage, disabled = false }: ApplicationsCardProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stages, setStages] = useState<ApplicationStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/applications`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setApplications(data ?? []);
    } catch {
      // silently fail — card stays empty
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchApplications(),
      fetch("/api/v1/application-stages")
        .then((r) => r.json())
        .then((j) => setStages(j.data ?? []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [fetchApplications]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const prev = applications;
      const oldIndex = prev.findIndex((a) => a.id === active.id);
      const newIndex = prev.findIndex((a) => a.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = arrayMove(prev, oldIndex, newIndex);
      setApplications(reordered); // optimistic

      try {
        const res = await fetch(`/api/v1/leads/${leadId}/applications/reorder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: reordered.map((a) => a.id) }),
        });
        if (!res.ok) throw new Error("Failed to reorder");
      } catch {
        setApplications(prev); // revert
        toast.error("Failed to reorder applications. Please try again.");
      }
    },
    [applications, leadId]
  );

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              Applications
              {!loading && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs normal-case">
                  {applications.length}
                </Badge>
              )}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => !disabled && setAddOpen(true)}
                title={disabled ? "Sign consent first" : "Add Application"}
                disabled={disabled}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : applications.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">No applications yet.</p>
          ) : canManage ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={applications.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {applications.map((app) => (
                    <SortableApplicationRow key={app.id} app={app} stages={stages} leadId={leadId} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="space-y-2">
              {applications.map((app) => (
                <div key={app.id} className="flex border rounded-md p-3 hover:bg-muted/30 transition-colors">
                  <ApplicationBody app={app} stages={stages} leadId={leadId} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddApplicationToLeadSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        leadId={leadId}
        stages={stages}
        onSuccess={() => {
          setAddOpen(false);
          fetchApplications();
        }}
      />
    </>
  );
}
