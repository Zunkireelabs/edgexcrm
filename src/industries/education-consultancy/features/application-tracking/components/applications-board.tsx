"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { ApplicationColumn } from "./application-column";
import { ApplicationCard } from "./application-card";
import type { Application, ApplicationStage } from "@/types/database";

type ColumnsState = Record<string, Application[]>;

function groupByStage(applications: Application[], stages: ApplicationStage[]): ColumnsState {
  const columns: ColumnsState = {};
  for (const stage of stages) columns[stage.id] = [];
  for (const app of applications) {
    if (app.stage_id && columns[app.stage_id]) {
      columns[app.stage_id].push(app);
    }
  }
  return columns;
}

function findAppColumn(columns: ColumnsState, appId: string): string | null {
  for (const [stageId, apps] of Object.entries(columns)) {
    if (apps.some((a) => a.id === appId)) return stageId;
  }
  return null;
}

interface ApplicationsBoardProps {
  stages: ApplicationStage[];
  applications: Application[];
  canManageApplications: boolean;
  onRefresh: () => void;
}

export function ApplicationsBoard({ stages, applications, canManageApplications, onRefresh }: ApplicationsBoardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [columns, setColumns] = useState<ColumnsState>(() => groupByStage(applications, stages));
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevColumnsRef = useRef<ColumnsState | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setColumns(groupByStage(applications, stages));
  }, [applications, stages]);

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeApp = activeId
    ? Object.values(columns).flat().find((a) => a.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    if (!canManageApplications) return;
    setActiveId(event.active.id as string);
    prevColumnsRef.current = JSON.parse(JSON.stringify(columns));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !activeId) return;

    const appId = active.id as string;
    const overId = over.id as string;
    const fromCol = findAppColumn(columns, appId);
    const toCol = stageMap.has(overId) ? overId : findAppColumn(columns, overId);

    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const from = prev[fromCol].filter((a) => a.id !== appId);
      const app = prev[fromCol].find((a) => a.id === appId);
      if (!app) return prev;
      const to = [...prev[toCol!]];
      const overIdx = to.findIndex((a) => a.id === overId);
      if (overIdx >= 0) to.splice(overIdx, 0, app);
      else to.push(app);
      return { ...prev, [fromCol]: from, [toCol!]: to };
    });
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const appId = active.id as string;
    const overId = over.id as string;
    const targetCol = stageMap.has(overId) ? overId : findAppColumn(columns, overId);

    if (!targetCol) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const app = Object.values(prevColumnsRef.current || columns).flat().find((a) => a.id === appId);
    if (!app || app.stage_id === targetCol) {
      prevColumnsRef.current = null;
      return;
    }

    try {
      const res = await fetch(`/api/v1/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: targetCol }),
      });
      if (!res.ok) throw new Error("Failed to move application");

      const { data: updated } = await res.json();
      const newStatus: string = (updated as Application)?.status ?? app.status;

      setColumns((prev) => {
        const next = { ...prev };
        for (const sid of Object.keys(next)) {
          next[sid] = next[sid].map((a) =>
            a.id === appId ? { ...a, stage_id: targetCol, status: newStatus } : a
          );
        }
        return next;
      });

      const newStage = stageMap.get(targetCol);
      if (newStage?.terminal_type === "won") toast.success("Application enrolled!");
      else if (newStage?.terminal_type === "lost") toast.error("Application ended.");

      onRefresh();
    } catch {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      toast.error("Failed to move application. Please try again.");
    }

    prevColumnsRef.current = null;
  }, [columns, stageMap, onRefresh]);

  const handleOpenDetail = useCallback((app: Application) => {
    router.push(`/applications/${app.id}`);
  }, [router]);

  if (!mounted) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {stages.map((stage) => (
          <div key={stage.id} className="flex-shrink-0 w-72 bg-muted/30 rounded-lg animate-pulse h-full" />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {stages.map((stage) => (
          <ApplicationColumn
            key={stage.id}
            stage={stage}
            applications={columns[stage.id] ?? []}
            canDrag={canManageApplications}
            onOpenDetail={handleOpenDetail}
          />
        ))}
      </div>

      <DragOverlay>
        {activeApp ? <ApplicationCard application={activeApp} disabled /> : null}
      </DragOverlay>
    </DndContext>
  );
}
