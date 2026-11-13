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
import { PhoneBoard } from "./phone-board";
import { STUCK_DAYS, daysInStage, isFinishedStage } from "../lib/card-metrics";
import { COLUMN_PAGE_SIZE, type BoardPayload } from "../lib/board-index";
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
import type { Application, ApplicationStage } from "@/types/database";

/** One column on the client: the cards loaded so far, plus the server's exact numbers. */
export interface ColumnState {
  cards: Application[];
  /** Filtered count of the whole column (server). */
  total: number;
  /** Filtered count stuck STUCK_DAYS+ (server). */
  stuck: number;
  /** Index offset of the next page (cards loaded FROM THE INDEX; a pinned moved card isn't one). */
  nextOffset: number;
  loading: boolean;
}
type ColumnsState = Record<string, ColumnState>;

export interface ColumnPage {
  cards: Application[];
  total: number;
  hasMore: boolean;
}

/** A card the user just dragged into a column: kept visible there until the column itself loads it. */
export interface Pin {
  appId: string;
  stageId: string;
  card: Application;
}

export function fromPayload(board: BoardPayload<Application>, pin: Pin | null): ColumnsState {
  const out: ColumnsState = {};
  for (const [sid, col] of Object.entries(board.columns)) {
    let cards = col.cards;
    if (pin) {
      if (sid === pin.stageId && !cards.some((c) => c.id === pin.appId)) cards = [pin.card, ...cards];
      else if (sid !== pin.stageId) cards = cards.filter((c) => c.id !== pin.appId);
    }
    out[sid] = { cards, total: col.total, stuck: col.stuck, nextOffset: col.cards.length, loading: false };
  }
  return out;
}

function findAppColumn(columns: ColumnsState, appId: string): string | null {
  for (const [stageId, col] of Object.entries(columns)) {
    if (col.cards.some((a) => a.id === appId)) return stageId;
  }
  return null;
}

interface ApplicationsBoardProps {
  /** Where a card opens (carries the board's filters for the detail page's back link). */
  detailHref?: (appId: string) => string;
  /** Column width in px (Narrow 232 / Wide 268). */
  columnWidth?: number;
  /** The selected pipeline's stages, in position order. */
  stages: ApplicationStage[];
  /** Server columns: first page of cards + exact filtered totals (EDGEX-141 Phase 3). */
  board: BoardPayload<Application>;
  /** Next page of one column, from the same URL state (GET /api/v1/applications/board-page). */
  fetchPage: (stageId: string, offset: number) => Promise<ColumnPage>;
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
  /**
   * Below md (EDGEX-141 Phase 5): one stage at a time with a stage strip, no drag (no DndContext),
   * and a Move sheet for admins. Same columns, paging and pinning.
   */
  phone?: boolean;
}

export function ApplicationsBoard({
  columnWidth,
  detailHref,
  stages,
  board,
  fetchPage,
  stageTotals,
  pipelineId,
  userId,
  canManageApplications,
  isAdmin,
  onRefresh,
  onAddToStage,
  onEditStages,
  assigneeNames,
  phone = false,
}: ApplicationsBoardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<BoardPrefs>(EMPTY_PREFS);
  const pinRef = useRef<Pin | null>(null);
  const [columns, setColumns] = useState<ColumnsState>(() => fromPayload(board, null));
  // Columns we already asked the server for (first page of a finished/collapsed column).
  const requested = useRef<Set<string>>(new Set());
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

  // A new server payload (URL change, router.refresh() after a move) replaces the columns: every
  // column is back to its first page, with the server's exact totals. A just-moved card stays pinned
  // at the top of its new column until that column's own pages include it.
  useEffect(() => {
    const pin = pinRef.current;
    if (pin && (board.columns[pin.stageId]?.cards ?? []).some((c) => c.id === pin.appId)) pinRef.current = null;
    requested.current = new Set();
    setColumns(fromPayload(board, pinRef.current));
  }, [board]);

  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  const inFlight = useRef<Set<string>>(new Set());

  /** Appends the next page of one column (dedupes by id, so a pinned card never doubles). */
  const loadPage = useCallback(
    async (stageId: string) => {
      const col = columnsRef.current[stageId];
      if (!col || inFlight.current.has(stageId)) return;
      inFlight.current.add(stageId);
      const offset = col.nextOffset;
      setColumns((prev) => (prev[stageId] ? { ...prev, [stageId]: { ...prev[stageId], loading: true } } : prev));
      try {
        const page = await fetchPage(stageId, offset);
        setColumns((prev) => {
          const cur = prev[stageId];
          if (!cur) return prev;
          const have = new Set(cur.cards.map((c) => c.id));
          const fresh = page.cards.filter((c) => !have.has(c.id));
          return { ...prev, [stageId]: { ...cur, cards: [...cur.cards, ...fresh], total: page.total, nextOffset: offset + page.cards.length, loading: false } };
        });
      } catch {
        setColumns((prev) => (prev[stageId] ? { ...prev, [stageId]: { ...prev[stageId], loading: false } } : prev));
        toast.error("Couldn't load more applications. Please try again.");
      } finally {
        inFlight.current.delete(stageId);
      }
    },
    [fetchPage],
  );

  // A column that renders expanded with nothing loaded (a finished column the user opened, or an
  // active one they re-expanded) fetches its first page once.
  useEffect(() => {
    if (!mounted) return;
    for (const stage of stages) {
      if (prefs.hidden.includes(stage.id) || isStageCollapsed(stage, prefs)) continue;
      const col = columns[stage.id];
      if (!col || col.total === 0 || col.nextOffset > 0 || requested.current.has(stage.id)) continue;
      requested.current.add(stage.id);
      void loadPage(stage.id);
    }
  }, [mounted, prefs, columns, stages, loadPage]);

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

  const allCards = (cols: ColumnsState) => Object.values(cols).flatMap((c) => c.cards);
  const activeApp = activeId ? allCards(columns).find((a) => a.id === activeId) ?? null : null;
  const activeStageId = activeId ? findAppColumn(columns, activeId) : null;

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
      const from = prev[fromCol].cards.filter((a) => a.id !== appId);
      const app = prev[fromCol].cards.find((a) => a.id === appId);
      if (!app) return prev;
      const to = [...prev[toCol].cards];
      const overIdx = to.findIndex((a) => a.id === overId);
      if (overIdx >= 0) to.splice(overIdx, 0, app);
      else to.unshift(app); // dropped on the column itself: top, so it is in view
      return { ...prev, [fromCol]: { ...prev[fromCol], cards: from }, [toCol]: { ...prev[toCol], cards: to } };
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
      const app = allCards(origin).find((a) => a.id === appId);
      const sourceCol = findAppColumn(origin, appId);
      if (!app || !sourceCol || sourceCol === targetCol) {
        prevColumnsRef.current = null;
        return;
      }
      // Counts follow the move at once (the refresh below then brings the server's exact numbers).
      const wasStuck = !isFinishedStage(stageMap.get(sourceCol)) && daysInStage(app.stage_changed_at) >= STUCK_DAYS;
      setColumns((prev) => ({
        ...prev,
        [sourceCol]: { ...prev[sourceCol], total: Math.max(0, prev[sourceCol].total - 1), stuck: Math.max(0, prev[sourceCol].stuck - (wasStuck ? 1 : 0)), nextOffset: Math.max(0, prev[sourceCol].nextOffset - 1) },
        [targetCol]: { ...prev[targetCol], total: prev[targetCol].total + 1 },
      }));

      try {
        const res = await fetch(`/api/v1/applications/${appId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_id: targetCol }),
        });
        if (!res.ok) throw new Error("Failed to move application");

        const { data: updated } = await res.json();
        const newStatus: string = (updated as Application)?.status ?? app.status;

        const moved: Application = { ...app, stage_id: targetCol, stage_changed_at: new Date().toISOString(), status: newStatus };
        pinRef.current = { appId, stageId: targetCol, card: moved };
        setColumns((prev) => {
          const next = { ...prev };
          for (const sid of Object.keys(next)) {
            next[sid] = { ...next[sid], cards: next[sid].cards.map((a) => (a.id === appId ? moved : a)) };
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
      router.push(detailHref ? detailHref(app.id) : `/applications/${app.id}`);
    },
    [router, detailHref],
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

  if (phone) {
    return (
      <PhoneBoard
        stages={stages}
        columns={columns}
        setColumns={setColumns}
        loadPage={loadPage}
        pinRef={pinRef}
        canManageApplications={canManageApplications}
        trackTime={(id) => !prefs.noAge.includes(id)}
        assigneeNames={assigneeNames}
        onOpenDetail={handleOpenDetail}
        onAddToStage={onAddToStage}
        onRefresh={onRefresh}
      />
    );
  }

  const visibleStages = stages.filter((s) => !prefs.hidden.includes(s.id));
  const hiddenStages = stages.filter((s) => prefs.hidden.includes(s.id));
  const active = visibleStages.filter((s) => !isFinishedStage(s));
  const finished = visibleStages.filter((s) => isFinishedStage(s));

  const renderStage = (stage: ApplicationStage) => {
    const col = columns[stage.id] ?? { cards: [], total: 0, stuck: 0, nextOffset: 0, loading: false };
    const isFinished = isFinishedStage(stage);
    if (isStageCollapsed(stage, prefs)) {
      return (
        <SlimColumn
          key={stage.id}
          stage={stage}
          count={col.total}
          onExpand={(s) => updatePrefs((p) => toggleCollapse(s, p))}
        />
      );
    }
    return (
      <ApplicationColumn
        key={stage.id}
        width={columnWidth}
        stage={stage}
        applications={col.cards}
        total={col.total}
        stuck={col.stuck}
        moreCount={Math.min(COLUMN_PAGE_SIZE, Math.max(0, col.total - col.nextOffset))}
        loadingMore={col.loading}
        onShowMore={() => loadPage(stage.id)}
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
        <div data-board-chrome className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 text-[12px] text-[#6b6f76]">
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
              finished={isFinishedStage(stageMap.get(activeStageId ?? activeApp.stage_id))}
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
