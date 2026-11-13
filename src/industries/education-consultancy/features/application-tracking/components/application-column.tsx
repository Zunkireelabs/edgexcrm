"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PlusIcon } from "@/components/icons";
import { ApplicationCard } from "./application-card";
import { ShowMoreButton, useRevealedCards } from "./column-show-more";
import { StageColumnMenu } from "./stage-column-menu";
import { STUCK_DAYS, daysInStage } from "../lib/card-metrics";
import type { Application, ApplicationStage } from "@/types/database";

interface ApplicationColumnProps {
  /** Column width in px (Narrow 232 / Wide 268). */
  width?: number;
  stage: ApplicationStage;
  applications: Application[];
  finished: boolean;
  canDrag: boolean;
  /** Can add applications (header "+" and "+ New application"). */
  canManage: boolean;
  /** Owner/admin: the "···" menu. */
  isAdmin: boolean;
  trackTime: boolean;
  assigneeNames?: Record<string, string>;
  onOpenDetail?: (app: Application) => void;
  onAdd: (stageId: string) => void;
  onRename: (stage: ApplicationStage, name: string) => Promise<boolean>;
  onTrackTime: (stage: ApplicationStage, on: boolean) => void;
  onCollapse: (stage: ApplicationStage) => void;
  onHide: (stage: ApplicationStage) => void;
  onEditStages: () => void;
  onDelete: (stage: ApplicationStage) => void;
}

export function ApplicationColumn({
  width = 268,
  stage,
  applications,
  finished,
  canDrag,
  canManage,
  isAdmin,
  trackTime,
  assigneeNames,
  onOpenDetail,
  onAdd,
  onRename,
  onTrackTime,
  onCollapse,
  onHide,
  onEditStages,
  onDelete,
}: ApplicationColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const { visible, showMore, nextBatch } = useRevealedCards(applications);

  // One stage-specific fact from loaded data. Required-document data does not exist, so no "missing docs".
  const stuck = finished ? 0 : applications.filter((a) => daysInStage(a.stage_changed_at) >= STUCK_DAYS).length;
  const fact = stuck > 0 ? `${stuck} stuck ${STUCK_DAYS}d+` : null;

  return (
    <div
      ref={setNodeRef}
      data-testid="board-column"
      data-stage-id={stage.id}
      style={{ width }}
      className={`relative flex max-h-full shrink-0 flex-col rounded-[16px] bg-[#FBFBFB] ${isOver ? "ring-2 ring-[#2272B4]/20" : ""}`}
    >
      <div className="mt-1 flex h-9 shrink-0 items-center gap-2 py-2 pr-2 pl-[14px]">
        <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
        <h3 className="truncate text-[14px] font-semibold text-[#101112]">{stage.name}</h3>
        <span
          data-testid="count-pill"
          className="inline-flex h-4 items-center rounded-[6px] bg-black/[.04] px-1 text-[12px] font-medium text-[#505155] tabular-nums shadow-[inset_0_0_0_1px_#EEEFF1]"
        >
          {applications.length}
        </span>
        <div className="ml-auto flex gap-0.5">
          {canManage && (
            <button
              type="button"
              title={`New application in ${stage.name}`}
              aria-label={`New application in ${stage.name}`}
              onClick={() => onAdd(stage.id)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[#9a9ea5] hover:bg-black/5 hover:text-[#101112]"
            >
              <PlusIcon className="h-[14px] w-[14px]" />
            </button>
          )}
          {isAdmin && (
            <StageColumnMenu
              stage={stage}
              trackTime={trackTime}
              onRename={(name) => onRename(stage, name)}
              onTrackTime={(on) => onTrackTime(stage, on)}
              onCollapse={() => onCollapse(stage)}
              onHide={() => onHide(stage)}
              onEditStages={onEditStages}
              onDelete={() => onDelete(stage)}
            />
          )}
        </div>
      </div>

      <div className="flex min-h-[60px] flex-col gap-2 overflow-y-auto px-[11px] pt-0.5 pb-2">
        {canManage && (
          <button
            type="button"
            onClick={() => onAdd(stage.id)}
            className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-black/[.06] bg-black/[.02] text-[13px] font-medium text-black/50 hover:bg-black/[.04] hover:text-[#101112]"
          >
            <PlusIcon className="h-[13px] w-[13px]" />
            New application
          </button>
        )}
        <SortableContext items={visible.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          {visible.map((app) => (
            <ApplicationCard
              key={app.id}
              application={app}
              disabled={!canDrag}
              finished={finished}
              showAge={trackTime}
              onOpenDetail={onOpenDetail}
              assigneeNames={assigneeNames}
            />
          ))}
        </SortableContext>
        <ShowMoreButton count={nextBatch} onClick={showMore} />
      </div>

      {(fact || finished) && (
        <div className="mx-1 flex shrink-0 gap-2.5 border-t border-[#f1f1f1] px-[14px] pt-2 pb-3 text-[12px] text-[#9a9ea5]">
          {finished ? (
            <button type="button" onClick={() => onCollapse(stage)} className="hover:text-[#101112]">
              Collapse to tidy the board
            </button>
          ) : (
            <span className="font-medium text-[#6b6f76]">{fact}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsed finished/collapsed column: 44px slim strip. Still a drop target. */
export function SlimColumn({
  stage,
  count,
  onExpand,
}: {
  stage: ApplicationStage;
  count: number;
  onExpand: (stage: ApplicationStage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <button
      type="button"
      ref={setNodeRef}
      data-testid="slim-column"
      data-stage-id={stage.id}
      title={`Expand ${stage.name}`}
      onClick={() => onExpand(stage)}
      className={`flex min-h-[240px] w-11 shrink-0 cursor-pointer flex-col items-center gap-2.5 rounded-[16px] bg-[#FBFBFB] py-3 hover:bg-[#f5f5f5] ${isOver ? "ring-2 ring-[#2272B4]/30" : ""}`}
    >
      <span className="h-[9px] w-[9px] rounded-full" style={{ backgroundColor: stage.color }} />
      <span className="inline-flex h-4 items-center rounded-[6px] bg-black/[.04] px-1 text-[12px] font-medium text-[#505155] tabular-nums shadow-[inset_0_0_0_1px_#EEEFF1]">
        {count}
      </span>
      <span className="text-[14px] font-semibold tracking-[.01em] text-[#101112] [writing-mode:vertical-rl]">{stage.name}</span>
    </button>
  );
}
