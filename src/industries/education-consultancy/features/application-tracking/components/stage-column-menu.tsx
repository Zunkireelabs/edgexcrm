"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowsInIcon,
  ClockIcon,
  DotsThreeIcon,
  EyeSlashIcon,
  SlidersHorizontalIcon,
  TrashIcon,
} from "@/components/icons";
import type { ApplicationStage } from "@/types/database";

interface StageColumnMenuProps {
  stage: ApplicationStage;
  trackTime: boolean;
  onRename: (name: string) => Promise<boolean>;
  onTrackTime: (on: boolean) => void;
  onCollapse: () => void;
  onHide: () => void;
  onEditStages: () => void;
  onDelete: () => void;
}

const ITEM = "flex h-[30px] w-full items-center gap-[9px] rounded-[8px] px-2 text-left text-[13px] text-[#2b2d2f] hover:bg-[#f6f7f9] hover:text-[#101112]";

/** Admin-only "···" menu on a board column (rename, time-in-stage, collapse, hide, edit, delete). */
export function StageColumnMenu({
  stage,
  trackTime,
  onRename,
  onTrackTime,
  onCollapse,
  onHide,
  onEditStages,
  onDelete,
}: StageColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(stage.name);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  async function submitRename() {
    const next = name.trim();
    if (!next || next === stage.name) return;
    setSaving(true);
    const ok = await onRename(next);
    setSaving(false);
    if (ok) close();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Stage options"
        aria-label={`${stage.name} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setName(stage.name);
          setOpen((o) => !o);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[#9a9ea5] hover:bg-black/5 hover:text-[#101112]"
      >
        <DotsThreeIcon className="h-[14px] w-[14px]" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 w-60 rounded-[12px] bg-white p-1 shadow-[0_10px_15px_-3px_rgb(0_0_0/.1),0_4px_6px_-4px_rgb(0_0_0/.1),0_0_0_1px_rgba(0,0,0,.06)]"
        >
          <div className="m-0.5 flex h-8 items-center gap-2 rounded-[8px] px-2 shadow-[inset_0_0_0_1px_#2272B4]">
            <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: stage.color }} />
            <input
              autoFocus
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitRename();
                }
              }}
              aria-label="Rename stage"
              maxLength={100}
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[#101112] outline-none"
            />
          </div>

          <button type="button" role="menuitemcheckbox" aria-checked={trackTime} onClick={() => onTrackTime(!trackTime)} className={`${ITEM} mt-1`}>
            <ClockIcon className="h-[15px] w-[15px] text-[#6b6f76]" />
            Track time in stage
            <span
              className={`relative ml-auto h-[15px] w-[26px] rounded-full ${trackTime ? "bg-[#2272B4]" : "bg-[#d0d3d7]"}`}
            >
              <span
                className={`absolute top-[2px] h-[11px] w-[11px] rounded-full bg-white transition-all ${trackTime ? "left-[13px]" : "left-[2px]"}`}
              />
            </span>
          </button>

          <div className="my-1 border-t border-[#f0f1f2]" />
          <button type="button" role="menuitem" onClick={act(onCollapse)} className={ITEM}>
            <ArrowsInIcon className="h-[15px] w-[15px] text-[#6b6f76]" />
            Collapse stage
          </button>
          <button type="button" role="menuitem" onClick={act(onHide)} className={ITEM}>
            <EyeSlashIcon className="h-[15px] w-[15px] text-[#6b6f76]" />
            Hide stage
          </button>
          <button type="button" role="menuitem" onClick={act(onEditStages)} className={ITEM}>
            <SlidersHorizontalIcon className="h-[15px] w-[15px] text-[#6b6f76]" />
            Edit stages…
            <span className="ml-auto text-[12px] text-[#9a9ea5]">colour, order</span>
          </button>
          <div className="my-1 border-t border-[#f0f1f2]" />
          <button type="button" role="menuitem" onClick={act(onDelete)} className={`${ITEM} !text-[#b42318]`}>
            <TrashIcon className="h-[15px] w-[15px] text-[#b42318]" />
            Delete stage…
          </button>
        </div>
      )}
    </div>
  );
}
