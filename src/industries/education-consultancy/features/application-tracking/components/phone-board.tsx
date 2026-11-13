"use client";

// The Applications board below md (EDGEX-141 Phase 5, temp_ss/applications-phone-v1.html states 1,
// 2, 3 and 5): one stage at a time.
//   - Stage strip: a sticky pill per stage (ink = on screen) with the server's filtered count;
//     Finished stages after a divider, outlined. Tap = jump; swiping the columns moves the pill.
//   - Columns: 326px (screen − 64) with scroll-snap so the next one peeks; no column header, no
//     slim finished columns, no drag. "Show N more" + 25-per-column paging as on desktop.
//   - Move: admins get a "⋯" on each card (or long-press 500ms) -> the Phase 4 stage picker in a
//     bottom sheet -> the same PATCH; success moves the card + counts and toasts Undo.
// The board's column state, paging and pinning stay in ApplicationsBoard; this only renders it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/icons";
import { ApplicationCard } from "./application-card";
import { ShowMoreButton } from "./column-show-more";
import { ListPicker, type PickerGroup } from "./list-picker";
import { COLUMN_PAGE_SIZE } from "../lib/board-index";
import { isFinishedStage } from "../lib/card-metrics";
import { moveCardBetweenColumns, openingStageId, stripOrder, type PhoneColumnState } from "../lib/phone-board";
import type { Application, ApplicationStage } from "@/types/database";

type Columns = Record<string, PhoneColumnState>;

export interface PhoneBoardProps {
  stages: ApplicationStage[];
  columns: Columns;
  setColumns: React.Dispatch<React.SetStateAction<Columns>>;
  loadPage: (stageId: string) => Promise<void>;
  /** Keeps a moved card at the top of its new column until the refreshed payload includes it. */
  pinRef: React.MutableRefObject<{ appId: string; stageId: string; card: Application } | null>;
  canManageApplications: boolean;
  trackTime: (stageId: string) => boolean;
  assigneeNames?: Record<string, string>;
  onOpenDetail: (app: Application) => void;
  onAddToStage: (stageId: string) => void;
  onRefresh: () => void;
  /** Test seam (defaults to window.fetch). */
  fetchImpl?: typeof fetch;
}

const EMPTY_COL: PhoneColumnState = { cards: [], total: 0, stuck: 0, nextOffset: 0, loading: false };
const COLUMN_GAP_PX = 8;

function studentOf(app: Application) {
  const l = app.leads;
  return (l ? [l.first_name, l.last_name].filter(Boolean).join(" ") : "") || "Unknown student";
}

/** The nearest vertical scroller (the dashboard's <main>), else the document. */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export function PhoneBoard({
  stages,
  columns,
  setColumns,
  loadPage,
  pinRef,
  canManageApplications,
  trackTime,
  assigneeNames,
  onOpenDetail,
  onAddToStage,
  onRefresh,
  fetchImpl,
}: PhoneBoardProps) {
  const { active, finished } = useMemo(() => stripOrder(stages), [stages]);
  const ordered = useMemo(() => [...active, ...finished], [active, finished]);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const totalOf = useCallback((id: string) => columns[id]?.total ?? 0, [columns]);

  const [current, setCurrent] = useState<string | null>(() => openingStageId(ordered, totalOf));
  // The current stage left the pipeline (a refresh): fall back to the opening rule.
  const currentId = current && stageById.has(current) ? current : openingStageId(ordered, totalOf);
  const [moving, setMoving] = useState<Application | null>(null);

  const stripRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const requested = useRef<Set<string>>(new Set());

  const columnEl = (id: string) => rowRef.current?.querySelector<HTMLElement>(`[data-phone-column="${id}"]`) ?? null;

  // Open on the current (first non-empty) stage without animation.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const col = currentId ? columnEl(currentId) : null;
    if (row && col) row.scrollLeft = col.offsetLeft - row.offsetLeft - parseFloat(getComputedStyle(row).paddingLeft || "0");
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the ink pill in view: scroll the strip so it sits just right of the left edge.
  useEffect(() => {
    const strip = stripRef.current;
    const pill = strip?.querySelector<HTMLElement>(`[data-stage-pill="${currentId}"]`);
    if (!strip || !pill) return;
    const left = Math.max(0, pill.offsetLeft - 56);
    if (typeof strip.scrollTo === "function") strip.scrollTo({ left, behavior: "smooth" });
    else strip.scrollLeft = left;
  }, [currentId]);

  // Finished (and any not-yet-loaded) column fetches its first page when it comes on screen.
  useEffect(() => {
    if (!currentId) return;
    const col = columns[currentId];
    if (!col || col.total === 0 || col.nextOffset > 0 || requested.current.has(currentId)) return;
    requested.current.add(currentId);
    void loadPage(currentId);
  }, [currentId, columns, loadPage]);

  /** Switching stage puts the column's top just under the stuck strip (if we had scrolled past it). */
  function resetVerticalScroll() {
    const strip = stripRef.current;
    const sentinel = sentinelRef.current;
    const scroller = scrollParentOf(strip);
    if (!strip || !sentinel || !scroller) return;
    const top = scroller.getBoundingClientRect().top;
    const natural = sentinel.getBoundingClientRect().top - top + scroller.scrollTop;
    const stuckAt = strip.getBoundingClientRect().top - top;
    if (natural - scroller.scrollTop < stuckAt) scroller.scrollTop = natural - stuckAt;
  }

  function jumpTo(id: string) {
    if (id === currentId) return;
    setCurrent(id);
    resetVerticalScroll();
    const row = rowRef.current;
    const col = columnEl(id);
    if (!row || !col) return;
    programmatic.current = true;
    const left = col.offsetLeft - row.offsetLeft - parseFloat(getComputedStyle(row).paddingLeft || "0");
    if (typeof row.scrollTo === "function") row.scrollTo({ left, behavior: "smooth" });
    else row.scrollLeft = left;
  }

  // A swipe settles on a column: that stage becomes current (the strip follows).
  function onRowScroll() {
    const row = rowRef.current;
    if (!row) return;
    const first = row.querySelector<HTMLElement>("[data-phone-column]");
    if (!first) return;
    const step = first.offsetWidth + COLUMN_GAP_PX;
    const idx = Math.max(0, Math.min(ordered.length - 1, Math.round(row.scrollLeft / step)));
    const id = ordered[idx]?.id;
    if (programmatic.current) {
      if (id === currentId) programmatic.current = false;
      return;
    }
    if (id && id !== currentId) {
      setCurrent(id);
      resetVerticalScroll();
    }
  }

  // ── Move to stage (sheet) ─────────────────────────────────────────────────────────────────────
  const columnOf = useCallback(
    (appId: string) => Object.keys(columns).find((sid) => columns[sid].cards.some((c) => c.id === appId)) ?? null,
    [columns],
  );

  const move = useCallback(
    async (app: Application, from: string, to: string, isUndo = false) => {
      const doFetch = fetchImpl ?? fetch;
      const toStage = stageById.get(to);
      try {
        const res = await doFetch(`/api/v1/applications/${app.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_id: to }),
        });
        if (!res.ok) throw new Error(`PATCH ${res.status}`);
        const json = (await res.json().catch(() => ({}))) as { data?: Partial<Application> };
        const moved: Application = {
          ...app,
          stage_id: to,
          placed_stage_id: to,
          stage_changed_at: new Date().toISOString(),
          status: json.data?.status ?? app.status,
        };
        pinRef.current = { appId: app.id, stageId: to, card: moved };
        setColumns((prev) => moveCardBetweenColumns(prev, { appId: app.id, from, to, moved, fromStage: stageById.get(from) }));
        onRefresh();
        const name = toStage?.name ?? "stage";
        if (isUndo) toast.success(`Moved back to ${name}`);
        else toast.success(`Moved to ${name}`, { action: { label: "Undo", onClick: () => void move(moved, to, from, true) } });
      } catch {
        toast.error("Couldn't move the application. Please try again.");
      }
    },
    [fetchImpl, stageById, pinRef, setColumns, onRefresh],
  );

  const movingFrom = moving ? columnOf(moving.id) ?? moving.placed_stage_id ?? moving.stage_id : null;
  const moveGroups = useMemo((): PickerGroup[] => {
    const item = (s: ApplicationStage) => ({
      value: s.id,
      label: s.name,
      checked: s.id === movingFrom,
      meta: (columns[s.id]?.total ?? 0).toLocaleString(),
      leading: <span className="size-[9px] shrink-0 rounded-full" style={{ background: s.color ?? "#9a9ea5" }} />,
    });
    const groups: PickerGroup[] = [{ items: active.map(item) }];
    if (finished.length) groups.push({ label: "Finished", items: finished.map(item) });
    return groups;
  }, [active, finished, columns, movingFrom]);

  const onMoveRequest = canManageApplications ? setMoving : undefined;
  const allEmpty = ordered.every((s) => (columns[s.id]?.total ?? 0) === 0);
  if (ordered.length === 0 || allEmpty) return null;

  const pill = (s: ApplicationStage, fin: boolean) => {
    const on = s.id === currentId;
    return (
      <button
        key={s.id}
        type="button"
        role="tab"
        aria-selected={on}
        data-stage-pill={s.id}
        data-testid="stage-pill"
        onClick={() => jumpTo(s.id)}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors ${
          on ? "bg-ds-ink text-white" : fin ? "bg-transparent text-ds-muted shadow-[inset_0_0_0_1px_var(--ds-border)]" : "bg-ds-hover text-ds-muted"
        }`}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: s.color ?? "#9a9ea5" }} />
        {s.name}
        <span data-testid="stage-pill-count" className={`font-medium tabular-nums ${on ? "text-white/70" : "text-ds-faint"}`}>
          {(columns[s.id]?.total ?? 0).toLocaleString()}
        </span>
      </button>
    );
  };

  return (
    <div data-testid="phone-board">
      <div ref={sentinelRef} aria-hidden="true" />
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Stages"
        data-testid="stage-strip"
        className="no-scrollbar sticky top-[-16px] z-20 -mx-4 flex items-center gap-1.5 overflow-x-auto bg-content-bg px-4 pt-2.5 pb-2"
      >
        {active.map((s) => pill(s, false))}
        {finished.length > 0 && (
          <span data-testid="strip-divider" className="inline-flex shrink-0 items-center gap-1.5 pr-0.5 pl-1 text-[11px] text-ds-faint">
            <span aria-hidden="true" className="h-[18px] w-px bg-ds-border" />
            Finished
          </span>
        )}
        {finished.map((s) => pill(s, true))}
      </div>

      <div
        ref={rowRef}
        onScroll={onRowScroll}
        data-testid="phone-columns"
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory items-start gap-2 overflow-x-auto scroll-px-4 px-4"
      >
        {ordered.map((stage) => {
          const col = columns[stage.id] ?? EMPTY_COL;
          const fin = isFinishedStage(stage);
          const on = stage.id === currentId;
          return (
            <div
              key={stage.id}
              data-phone-column={stage.id}
              data-testid="phone-column"
              aria-hidden={!on}
              className={`w-[calc(100vw-64px)] shrink-0 snap-start rounded-t-[16px] bg-[#FBFBFB] ${on ? "" : "max-h-[70dvh] overflow-hidden"}`}
            >
              <div className="flex flex-col gap-2 px-2.5 pt-2.5 pb-3">
                {canManageApplications && !fin && (
                  <button
                    type="button"
                    onClick={() => onAddToStage(stage.id)}
                    className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-black/[.06] bg-black/[.02] text-[13px] font-medium text-black/50"
                  >
                    <PlusIcon className="h-[13px] w-[13px]" />
                    New application
                  </button>
                )}
                {col.cards.map((app) => (
                  <ApplicationCard
                    key={app.id}
                    application={app}
                    disabled
                    finished={fin}
                    showAge={!fin && trackTime(stage.id)}
                    onOpenDetail={onOpenDetail}
                    assigneeNames={assigneeNames}
                    onMoveRequest={onMoveRequest}
                  />
                ))}
                {col.total > 0 && col.cards.length === 0 && col.loading && (
                  <div className="py-6 text-center text-[13px] text-ds-faint">Loading…</div>
                )}
                {col.total === 0 && <div className="py-6 text-center text-[13px] text-ds-faint">No applications in {stage.name}</div>}
                <ShowMoreButton
                  count={Math.min(COLUMN_PAGE_SIZE, Math.max(0, col.total - col.nextOffset))}
                  loading={col.loading}
                  onClick={() => void loadPage(stage.id)}
                  className="h-9"
                />
              </div>
            </div>
          );
        })}
        {/* Lets the last column snap to the left edge too: row width − column − gap. */}
        <div aria-hidden="true" className="h-px w-[calc(100%-100vw+56px)] shrink-0" />
      </div>

      {moving && (
        <ListPicker
          open
          onOpenChange={(o) => !o && setMoving(null)}
          container="sheet"
          title="Move to stage"
          subtitle={`${studentOf(moving)} · ${moving.university_name}`}
          searchable={false}
          placeholder="Move to stage"
          groups={moveGroups}
          testId="move-stage-sheet"
          onPick={(to) => {
            const app = moving;
            const from = movingFrom;
            setMoving(null);
            if (!from || to === from) return;
            void move(app, from, to);
          }}
        />
      )}
    </div>
  );
}
