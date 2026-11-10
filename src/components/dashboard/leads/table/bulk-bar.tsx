"use client";

// Floating bulk-action bar (EDGEX-117). Sits inside a `relative` wrapper around the table and
// pagination, so it never shifts the layout. All handlers and gates come from leads-table.tsx;
// this file only decides which buttons to show (getBulkBarActions, unit-tested) and draws them.

import { useState } from "react";
import {
  ArrowCircleUpIcon,
  BuildingsIcon,
  CaretDownIcon,
  CircleDashedIcon,
  GitBranchIcon,
  GitMergeIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
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
  /** EDGEX-127 bulk Add tag (same write gate as Move stage / Assign). */
  addTag: boolean;
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
      addTag: false,
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
    addTag: canWrite,
    archive: canWrite && i.hasArchiveList,
    more,
    selection,
  };
}

export interface BulkBarHandlers {
  onMoveStage: () => void;
  onAssign: () => void;
  /** EDGEX-127: opens the Add tag command dialog. */
  onAddTag: () => void;
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

// Approved bulk bar v2 (mockup "leads-table-v2-bulk"): white floating bar, raised 32px buttons.
const BAR_SHADOW = "shadow-[0_0_0_1px_rgba(28,40,64,.04),0_4px_8px_-4px_rgba(28,40,64,.12),0_4px_12px_-2px_rgba(24,41,75,.16)]";
const BTN =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] bg-ds-surface pl-2 pr-2.5 text-sm font-medium text-ds-ink shadow-[0_0_2px_rgba(28,40,64,.18),0_1px_3px_rgba(0,0,0,.04)] transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost data-[state=open]:bg-ds-hover [&>svg]:size-4 [&>svg]:text-ds-muted";
const DIV = "mx-0.5 h-5 w-px bg-ds-border";

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
  const countText = actions.selection === "all-selected" ? effectiveTotal.toLocaleString() : selectedCount.toLocaleString();

  const moreItem = (action: string, label: string, icon: React.ReactNode, onClick: () => void, destructive = false) => (
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
  const hasMore = actions.more.length > 0 || actions.archive;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      data-testid="bulk-bar"
      className={`pointer-events-auto absolute bottom-7 left-1/2 z-30 flex h-12 -translate-x-1/2 items-center gap-1.5 rounded-[14px] bg-ds-surface p-2 text-ds-ink ${BAR_SHADOW}`}
    >
      <span className="flex h-8 items-center gap-2 rounded-[9px] bg-ds-hover pl-1.5 pr-2 text-sm text-ds-muted">
        <span className="grid h-5 min-w-5 place-items-center rounded-[6px] bg-ds-accent px-1.5 text-xs font-semibold tabular-nums text-white" aria-live="polite">
          {countText}
        </span>
        Selected
        <button type="button" onClick={handlers.onClear} aria-label="Deselect all" className="grid size-4 place-items-center text-ds-faint hover:text-ds-ink">
          <XIcon className="size-3.5" />
        </button>
      </span>
      {actions.selection === "select-all" && (
        <button type="button" className="whitespace-nowrap px-1.5 text-sm text-ds-accent hover:underline" onClick={handlers.onSelectAllMatching}>
          Select all {effectiveTotal.toLocaleString()}
        </button>
      )}
      <span className={DIV} />
      {actions.restore && (
        <button type="button" className={BTN} onClick={handlers.onRestore}>
          Restore
        </button>
      )}
      {actions.deleteForever && (
        <button type="button" className={`${BTN} !text-ds-bad`} onClick={handlers.onDeleteForever}>
          Delete
        </button>
      )}
      {actions.moveStage && (
        <button type="button" className={BTN} onClick={handlers.onMoveStage}>
          <CircleDashedIcon aria-hidden />
          {stageLabel}
        </button>
      )}
      {actions.assign && (
        <button type="button" className={BTN} onClick={handlers.onAssign}>
          <UserIcon aria-hidden />
          Assign
        </button>
      )}
      {actions.addTag && (
        <button type="button" className={BTN} onClick={handlers.onAddTag}>
          <TagIcon aria-hidden />
          Add tag
        </button>
      )}
      {hasMore && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={BTN} aria-label="More actions">
              More
              <CaretDownIcon aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" sideOffset={12} className={`${POP} w-[220px] rounded-[12px]`}>
            {actions.more.includes("enroll") && moreItem("enroll", "Enroll in sequence", <GitBranchIcon className="size-4 text-ds-faint" />, handlers.onEnroll)}
            {actions.more.includes("branch") && moreItem("branch", "Share to branch", <BuildingsIcon className="size-4 text-ds-faint" />, handlers.onBranch)}
            {actions.more.includes("graduate") && moreItem("graduate", "Graduate → Sales Leads", <ArrowCircleUpIcon className="size-4 text-ds-faint" />, handlers.onGraduate)}
            {actions.more.includes("merge") && moreItem("merge", "Merge", <GitMergeIcon className="size-4 text-ds-faint" />, handlers.onMerge)}
            {actions.more.includes("delete") && moreItem("delete", "Delete", <TrashIcon className="size-4" />, handlers.onDelete, true)}
            {actions.archive && moreItem("archive", "Archive leads", <TrashIcon className="size-4" />, handlers.onArchive, true)}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
