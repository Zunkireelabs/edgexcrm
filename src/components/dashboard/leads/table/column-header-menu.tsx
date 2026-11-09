"use client";

// The shared column menu (EDGEX-117): one popover for the whole grid, mounted only while open and
// anchored to the clicked header. Items follow the approved mockup: sort, filter, pin, move, rename, hide.

import { useEffect, useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  EyeSlashIcon,
  FunnelSimpleIcon,
  PencilSimpleIcon,
  PushPinIcon,
} from "@/components/icons";
import { ITEM, POP, POP_SEP } from "../toolbar/tokens";
import { directionOptions, sortOption } from "../toolbar/sort-options";
import type { SortDirection } from "../toolbar/view-state";
import { MAX_LABEL_LENGTH } from "./grid-prefs";

export interface ColumnMenuModel {
  key: string;
  /** Title currently shown in the header (custom rename, else default). */
  title: string;
  defaultTitle: string;
  isName: boolean;
  /** Sort key the table understands, when the API can sort this column. */
  sortKey?: string;
  activeSortDirection: SortDirection | null;
  canFilter: boolean;
  pinned: boolean;
  canPin: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}

export interface ColumnHeaderMenuProps {
  anchor: HTMLElement;
  model: ColumnMenuModel;
  onClose: () => void;
  onSort: (sortKey: string, direction: SortDirection) => void;
  onFilter: () => void;
  onTogglePin: () => void;
  onMove: (dir: "left" | "right") => void;
  /** null restores the default title. */
  onRename: (label: string | null) => void;
  onHide: () => void;
}

const SHORTCUT = "text-xs font-medium text-ds-faint";

export function ColumnHeaderMenu({ anchor, model, onClose, onSort, onFilter, onTogglePin, onMove, onRename, onHide }: ColumnHeaderMenuProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(model.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const togglePin = useRef(onTogglePin);
  useEffect(() => {
    togglePin.current = onTogglePin;
  });

  // ⌘P / Ctrl+P pins or unpins, only while this menu is open.
  const canTogglePin = !model.isName && (model.pinned || model.canPin);
  useEffect(() => {
    if (model.isName) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (canTogglePin) {
          togglePin.current();
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [model.isName, canTogglePin, onClose]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function commitRename() {
    const next = draft.trim().slice(0, MAX_LABEL_LENGTH);
    onRename(next === "" || next === model.defaultTitle ? null : next);
    onClose();
  }

  const sortChoices = model.sortKey ? directionOptions(sortOption(model.sortKey).kind) : [];
  // Direction wording by kind, but the menu speaks in plain ascending / descending like the mockup.
  const asc = sortChoices.length > 0 && model.sortKey ? "asc" : null;

  return (
    <PopoverPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <PopoverPrimitive.Anchor virtualRef={{ current: anchor }} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={2}
          collisionPadding={8}
          data-testid="column-header-menu"
          className={`${POP} z-50 w-[220px] outline-none`}
          onEscapeKeyDown={(e) => {
            if (renaming) {
              e.preventDefault();
              setRenaming(false);
            }
          }}
        >
          {renaming ? (
            <div className="p-1">
              <label className="mb-1 block px-1 text-xs font-medium text-ds-faint" htmlFor="rename-column-input">
                Rename column
              </label>
              <input
                id="rename-column-input"
                ref={inputRef}
                value={draft}
                maxLength={MAX_LABEL_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenaming(false);
                  }
                }}
                placeholder={model.defaultTitle}
                className="h-8 w-full rounded-ds-xs bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
              />
              <p className="px-1 pt-1 text-xs text-ds-faint">Enter to save · Esc to cancel · empty restores “{model.defaultTitle}”</p>
            </div>
          ) : (
            <>
              {model.sortKey && asc && (
                <>
                  <button
                    type="button"
                    className={ITEM}
                    onClick={() => {
                      onSort(model.sortKey!, "asc");
                      onClose();
                    }}
                  >
                    <ArrowUpIcon className="size-4 text-ds-faint" />
                    <span className="flex-1">Sort ascending</span>
                    {model.activeSortDirection === "asc" && <CheckIcon className="size-4 text-ds-accent" />}
                  </button>
                  <button
                    type="button"
                    className={ITEM}
                    onClick={() => {
                      onSort(model.sortKey!, "desc");
                      onClose();
                    }}
                  >
                    <ArrowDownIcon className="size-4 text-ds-faint" />
                    <span className="flex-1">Sort descending</span>
                    {model.activeSortDirection === "desc" && <CheckIcon className="size-4 text-ds-accent" />}
                  </button>
                </>
              )}
              {model.canFilter && (
                <>
                  {model.sortKey && <div className={POP_SEP} />}
                  <button
                    type="button"
                    className={ITEM}
                    onClick={() => {
                      onFilter();
                      onClose();
                    }}
                  >
                    <FunnelSimpleIcon className="size-4 text-ds-faint" />
                    <span className="min-w-0 flex-1 truncate">Filter by {model.defaultTitle}</span>
                  </button>
                </>
              )}
              {!model.isName && (
                <>
                  <div className={POP_SEP} />
                  <button
                    type="button"
                    className={`${ITEM} disabled:pointer-events-none disabled:opacity-50`}
                    disabled={!canTogglePin}
                    title={!canTogglePin ? "Up to 2 columns can be pinned. Unpin one first." : undefined}
                    onClick={() => {
                      onTogglePin();
                      onClose();
                    }}
                  >
                    <PushPinIcon className="size-4 text-ds-faint" />
                    <span className="flex-1">{model.pinned ? "Unpin column" : "Pin column"}</span>
                    <span className={SHORTCUT}>⌘ P</span>
                  </button>
                  {model.canMoveLeft && (
                    <button type="button" className={ITEM} onClick={() => onMove("left")}>
                      <ArrowLeftIcon className="size-4 text-ds-faint" />
                      <span className="flex-1">Move left</span>
                    </button>
                  )}
                  {model.canMoveRight && (
                    <button type="button" className={ITEM} onClick={() => onMove("right")}>
                      <ArrowRightIcon className="size-4 text-ds-faint" />
                      <span className="flex-1">Move right</span>
                    </button>
                  )}
                </>
              )}
              <div className={POP_SEP} />
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  setDraft(model.title);
                  setRenaming(true);
                }}
              >
                <PencilSimpleIcon className="size-4 text-ds-faint" />
                <span className="flex-1">Rename column</span>
              </button>
              {!model.isName && (
                <button
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    onHide();
                    onClose();
                  }}
                >
                  <EyeSlashIcon className="size-4 text-ds-faint" />
                  <span className="flex-1">Hide from view</span>
                </button>
              )}
            </>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
