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
import { PlusIcon, XIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApplicationColumn, SlimColumn } from "./application-column";
import { ApplicationCard } from "./application-card";
import { isFinishedStage } from "../lib/card-metrics";
import {
  EMPTY_PREFS,
  isStageCollapsed,
  readBoardPrefs,
  setHidden,
  setTrackTime,
  toggleCollapse,
  writeBoardPrefs,
  type BoardPrefs,
} from "../lib/board-prefs";
import type { BoardPlacement } from "../lib/board-placement";
import type { Application, ApplicationStage } from "@/types/database";

type ColumnsState = Record<string, Application[]>;

function groupByStage(
  applications: Application[],
  stages: ApplicationStage[],
  placements: Map<string, BoardPlacement>,
): ColumnsState {
  const columns: ColumnsState = {};
  for (const stage of stages) columns[stage.id] = [];
  for (const app of applications) {
    const stageId = placements.get(app.id)?.stageId ?? app.stage_id;
    if (stageId && columns[stageId]) columns[stageId].push(app);
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
  /** The selected pipeline's stages, in position order. */
  stages: ApplicationStage[];
  applications: Application[];
  /** app id -> effective pipeline/stage (see lib/board-placement). */
  placements: Map<string, BoardPlacement>;
  /** Unfiltered application count per stage, for the delete-stage message. */
  stageTotals: Record<string, number>;
  pipelineId: string;
  userId: string;
  canManageApplications: boolean;
  isAdmin: boolean;
  onRefresh: () => void;
  onAddToStage: (stageId: string) => void;
  onEditStages: (opts?: { addStage?: boolean }) => void;
  /** user_id -> display name, for resolving a card's counsellor. */
  assigneeNames?: Record<string, string>;
}

export function ApplicationsBoard({
  stages,
  applications,
  placements,
  stageTotals,
  pipelineId,
  userId,
  canManageApplications,
  isAdmin,
  onRefresh,
  onAddToStage,
  onEditStages,
  assigneeNames,
}: ApplicationsBoardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<BoardPrefs>(EMPTY_PREFS);
  const [columns, setColumns] = useState<ColumnsState>(() => groupByStage(applications, stages, placements));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApplicationStage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const prevColumnsRef = useRef<ColumnsState | null>(null);

  // Prefs live in localStorage, so they are read after mount (no SSR mismatch).
  useEffect(() => {
    const id = setTimeout(() => {
      setPrefs(readBoardPrefs(userId, pipelineId));
      setMounted(true);
    }, 0);
    return () => clearTimeout(id);
  }, [userId, pipelineId]);

  useEffect(() => {
    setColumns(groupByStage(applications, stages, placements));
  }, [applications, stages, placements]);

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const updatePrefs = useCallback(
    (fn: (p: BoardPrefs) => BoardPrefs) => {
      setPrefs((prev) => {
        const next = fn(prev);
        writeBoardPrefs(userId, pipelineId, next);
        return next;
      });
    },
    [userId, pipelineId],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeApp = activeId ? Object.values(columns).flat().find((a) => a.id === activeId) ?? null : null;

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
    const overIsColumn = stageMap.has(overId);
    const toCol = overIsColumn ? overId : findAppColumn(columns, overId);

    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const from = prev[fromCol].filter((a) => a.id !== appId);
      const app = prev[fromCol].find((a) => a.id === appId);
      if (!app) return prev;
      const to = [...prev[toCol]];
      const overIdx = to.findIndex((a) => a.id === overId);
      if (overIdx >= 0) to.splice(overIdx, 0, app);
      else to.unshift(app); // dropped on the column itself: top, so it is inside the first 25 shown
      return { ...prev, [fromCol]: from, [toCol]: to };
    });
  }

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      const rollback = () => {
        if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
        prevColumnsRef.current = null;
      };

      if (!over) return rollback();

      const appId = active.id as string;
      const overId = over.id as string;
      const targetCol = stageMap.has(overId) ? overId : findAppColumn(columns, overId);
      if (!targetCol) return rollback();

      const origin = prevColumnsRef.current ?? columns;
      const app = Object.values(origin).flat().find((a) => a.id === appId);
      if (!app || findAppColumn(origin, appId) === targetCol) {
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
              a.id === appId ? { ...a, stage_id: targetCol, stage_changed_at: new Date().toISOString(), status: newStatus } : a,
            );
          }
          return next;
        });

        const newStage = stageMap.get(targetCol);
        if (newStage?.terminal_type === "won") toast.success("Application enrolled!");
        else if (newStage?.terminal_type === "lost") toast.error("Application ended.");

        onRefresh();
      } catch {
        rollback();
        toast.error("Failed to move application. Please try again.");
      }

      prevColumnsRef.current = null;
    },
    [columns, stageMap, onRefresh],
  );

  const handleOpenDetail = useCallback(
    (app: Application) => {
      router.push(`/applications/${app.id}`);
    },
    [router],
  );

  const renameStage = useCallback(
    async (stage: ApplicationStage, name: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/v1/application-pipelines/${pipelineId}/stages/${stage.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error?.message || "Failed to rename stage");
        }
        toast.success("Stage renamed");
        onRefresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to rename stage");
        return false;
      }
    },
    [pipelineId, onRefresh],
  );

  const deleteTotal = deleteTarget ? stageTotals[deleteTarget.id] ?? 0 : 0;

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/application-pipelines/${pipelineId}/stages/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 409
            ? `Move the applications out of ${deleteTarget.name} first`
            : json?.error?.message || "Failed to delete stage",
        );
      }
      toast.success("Stage deleted");
      setDeleteTarget(null);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete stage");
    } finally {
      setDeleting(false);
    }
  }

  if (!mounted) return <div className="h-full" />;

  const visibleStages = stages.filter((s) => !prefs.hidden.includes(s.id));
  const hiddenStages = stages.filter((s) => prefs.hidden.includes(s.id));
  const active = visibleStages.filter((s) => !isFinishedStage(s));
  const finished = visibleStages.filter((s) => isFinishedStage(s));

  const renderStage = (stage: ApplicationStage) => {
    const apps = columns[stage.id] ?? [];
    const isFinished = isFinishedStage(stage);
    if (isStageCollapsed(stage, prefs)) {
      return (
        <SlimColumn
          key={stage.id}
          stage={stage}
          count={apps.length}
          onExpand={(s) => updatePrefs((p) => toggleCollapse(s, p))}
        />
      );
    }
    return (
      <ApplicationColumn
        key={stage.id}
        stage={stage}
        applications={apps}
        finished={isFinished}
        canDrag={canManageApplications}
        canManage={canManageApplications}
        isAdmin={isAdmin}
        trackTime={!prefs.noAge.includes(stage.id)}
        assigneeNames={assigneeNames}
        onOpenDetail={handleOpenDetail}
        onAdd={onAddToStage}
        onRename={renameStage}
        onTrackTime={(s, on) => updatePrefs((p) => setTrackTime(p, s.id, on))}
        onCollapse={(s) => updatePrefs((p) => toggleCollapse(s, p))}
        onHide={(s) => updatePrefs((p) => setHidden(p, s.id, true))}
        onEditStages={() => onEditStages()}
        onDelete={setDeleteTarget}
      />
    );
  };

  return (
    <>
      {hiddenStages.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 text-[12px] text-[#6b6f76]">
          <span>{hiddenStages.length} hidden:</span>
          {hiddenStages.map((s) => (
            <button
              key={s.id}
              type="button"
              title={`Show ${s.name} again`}
              onClick={() => updatePrefs((p) => setHidden(p, s.id, false))}
              className="inline-flex h-6 items-center gap-1.5 rounded-[6px] bg-[#f6f7f9] px-2 font-medium text-[#2b2d2f] hover:bg-[#eceef1]"
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
              <XIcon className="h-3 w-3 rotate-45 text-[#9a9ea5]" />
            </button>
          ))}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full items-start gap-2 overflow-x-auto pb-1" data-testid="applications-board">
          {active.map(renderStage)}
          {finished.length > 0 && <span className="my-1.5 mx-1.5 w-px shrink-0 self-stretch bg-[#e8e9eb]" />}
          {finished.map(renderStage)}
          {isAdmin && (
            <button
              type="button"
              title="Add stage"
              aria-label="Add stage"
              onClick={() => onEditStages({ addStage: true })}
              className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[16px] border border-dashed border-[#e6e7ea] text-[#6b6f76] hover:bg-[#f6f7f9] hover:text-[#101112]"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <DragOverlay>
          {activeApp ? (
            <ApplicationCard
              application={activeApp}
              disabled
              assigneeNames={assigneeNames}
              finished={isFinishedStage(stageMap.get(placements.get(activeApp.id)?.stageId ?? activeApp.stage_id))}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              {deleteTotal > 0
                ? `Move the ${deleteTotal} ${deleteTotal === 1 ? "application" : "applications"} out of ${deleteTarget?.name} first.`
                : "This stage is empty. Deleting it can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {deleteTotal > 0 ? "OK" : "Cancel"}
            </Button>
            {deleteTotal === 0 && (
              <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
                {deleting ? "Deleting…" : "Delete stage"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
