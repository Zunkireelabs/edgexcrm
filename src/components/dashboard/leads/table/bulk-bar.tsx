"use client";

// Floating bulk-action bar (EDGEX-117). Sits inside a `relative` wrapper around the table and
// pagination, so it never shifts the layout. All handlers and gates come from leads-table.tsx;
// this file only decides which buttons to show (getBulkBarActions, unit-tested) and draws them.

import { useState } from "react";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowCircleUpIcon,
  ArrowBendUpRightIcon,
  BuildingsIcon,
  DotsThreeIcon,
  GitBranchIcon,
  GitMergeIcon,
  TrashIcon,
  UserPlusIcon,
  XIcon,
} from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ITEM, POP } from "../toolbar/tokens";

export type MoreAction = "enroll" | "branch" | "graduate" | "merge" | "delete";

export interface BulkGateInput {
  viewMode: "normal" | "trash" | "archived";
  isAdmin: boolean;
  isTeamScoped: boolean;
  selectedCount: number;
  teamMemberCount: number;
  isStagingView: boolean;
  hasOutreach: boolean;
  showBranches: boolean;
  branchCount: number;
  canGraduate: boolean;
  hasArchiveList: boolean;
  /** The current page is fully selected. */
  pageFullySelected: boolean;
  /** Rows on this page. */
  pageCount: number;
  effectiveTotal: number;
  allResultsSelected: boolean;
}

export interface BulkActions {
  restore: boolean;
  deleteForever: boolean;
  moveStage: boolean;
  assign: boolean;
  archive: boolean;
  more: MoreAction[];
  /** "select-all" = offer `Select all N`; "all-selected" = the count reads `All N selected`. */
  selection: "select-all" | "all-selected" | null;
}

/** Same gates as the legacy bar (leads-table.tsx), regrouped. */
export function getBulkBarActions(i: BulkGateInput): BulkActions {
  const selection: BulkActions["selection"] =
    i.pageFullySelected && i.effectiveTotal > i.pageCount ? (i.allResultsSelected ? "all-selected" : "select-all") : null;
  if (i.viewMode !== "normal") {
    return {
      restore: i.isAdmin,
      deleteForever: i.viewMode === "archived",
      moveStage: false,
      assign: false,
      archive: false,
      more: [],
      selection,
    };
  }
  const canWrite = i.isAdmin || i.isTeamScoped;
  const more: MoreAction[] = [];
  if (i.hasOutreach && !i.isStagingView) more.push("enroll");
  if (i.isAdmin && !i.isStagingView && i.showBranches && i.branchCount > 0) more.push("branch");
  if (canWrite && i.canGraduate) more.push("graduate");
  if (i.isAdmin && !i.isStagingView && i.selectedCount === 2) more.push("merge");
  if (canWrite) more.push("delete");
  return {
    restore: false,
    deleteForever: false,
    moveStage: canWrite,
    assign: canWrite && i.teamMemberCount > 0,
    archive: canWrite && i.hasArchiveList,
    more,
    selection,
  };
}

export interface BulkBarHandlers {
  onMoveStage: () => void;
  onAssign: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onEnroll: () => void;
  onBranch: () => void;
  onGraduate: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
}

const BTN =
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-xs px-2 text-sm font-medium text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60";
const DIV = "mx-1 h-4 w-px bg-white/20";

export function BulkBar({
  selectedCount,
  effectiveTotal,
  actions,
  handlers,
  stageLabel = "Move stage",
}: {
  selectedCount: number;
  effectiveTotal: number;
  actions: BulkActions;
  handlers: BulkBarHandlers;
  stageLabel?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (selectedCount === 0) return null;
  const countText = actions.selection === "all-selected" ? `All ${effectiveTotal.toLocaleString()} selected` : `${selectedCount.toLocaleString()} selected`;

  const moreItem = (action: MoreAction, label: string, icon: React.ReactNode, onClick: () => void, destructive = false) => (
    <button
      key={action}
      type="button"
      className={`${ITEM} ${destructive ? "text-ds-bad" : ""}`}
      onClick={() => {
        setMoreOpen(false);
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      data-testid="bulk-bar"
      className="pointer-events-auto absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-ds-ink p-1 text-white shadow-[0_0_0_1px_rgba(16,17,18,.06),0_8px_24px_-4px_rgba(16,17,18,.14),0_2px_6px_rgba(16,17,18,.06)]"
    >
      <span className="px-2 text-sm font-medium tabular-nums" aria-live="polite">
        {countText}
      </span>
      {actions.selection === "select-all" && (
        <button type="button" className={`${BTN} text-white/90 underline underline-offset-2`} onClick={handlers.onSelectAllMatching}>
          Select all {effectiveTotal.toLocaleString()}
        </button>
      )}
      <span className={DIV} />
      {actions.restore && (
        <button type="button" className={BTN} onClick={handlers.onRestore}>
          <ArrowCounterClockwiseIcon className="size-4" />
          Restore
        </button>
      )}
      {actions.deleteForever && (
        <button type="button" className={`${BTN} text-red-300`} onClick={handlers.onDeleteForever}>
          <TrashIcon className="size-4" />
          Delete
        </button>
      )}
      {actions.moveStage && (
        <button type="button" className={BTN} onClick={handlers.onMoveStage}>
          <ArrowBendUpRightIcon className="size-4" />
          {stageLabel}
        </button>
      )}
      {actions.assign && (
        <button type="button" className={BTN} onClick={handlers.onAssign}>
          <UserPlusIcon className="size-4" />
          Assign
        </button>
      )}
      {(actions.moveStage || actions.assign) && (actions.archive || actions.more.length > 0) && <span className={DIV} />}
      {actions.archive && (
        <button type="button" className={`${BTN} text-red-300`} onClick={handlers.onArchive}>
          <ArchiveIcon className="size-4" />
          Archive
        </button>
      )}
      {actions.more.length > 0 && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={BTN} aria-label="More actions">
              <DotsThreeIcon className="size-4" />
              More
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" side="top" sideOffset={8} className={`${POP} w-[220px]`}>
            {actions.more.includes("enroll") && moreItem("enroll", "Enroll in sequence", <GitBranchIcon className="size-4 text-ds-faint" />, handlers.onEnroll)}
            {actions.more.includes("branch") && moreItem("branch", "Share to branch", <BuildingsIcon className="size-4 text-ds-faint" />, handlers.onBranch)}
            {actions.more.includes("graduate") && moreItem("graduate", "Graduate → Sales Leads", <ArrowCircleUpIcon className="size-4 text-ds-faint" />, handlers.onGraduate)}
            {actions.more.includes("merge") && moreItem("merge", "Merge", <GitMergeIcon className="size-4 text-ds-faint" />, handlers.onMerge)}
            {actions.more.includes("delete") && moreItem("delete", "Delete", <TrashIcon className="size-4" />, handlers.onDelete, true)}
          </PopoverContent>
        </Popover>
      )}
      <span className={DIV} />
      <button type="button" className={`${BTN} w-7 justify-center px-0`} onClick={handlers.onClear} aria-label="Deselect all">
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
