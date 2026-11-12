"use client";

import { useMemo, useRef, useState } from "react";
import { ArchiveIcon, ArrowBendUpLeftIcon, ArrowRightIcon, CaretDownIcon, CheckCircleIcon, CircleIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Dot } from "../record-preview/parts";
import { rememberOrigin } from "./focus-origin";
import { Picker, type PickerOption } from "./picker";
import type { RequirementAction, StageCardModel } from "./lib/stage-card-model";
import type { PipelineStage } from "@/types/database";

/** Grid columns for the stage bar and its labels: weighted by label length so "Applications" is never cut at 320px (even with a 12px scrollbar). */
export function segmentGrid(names: readonly string[]): string {
  return names.length ? names.map((n) => `minmax(0, ${Math.max(n.length, 7)}fr)`).join(" ") : "minmax(0, 1fr)";
}

const BTN = "inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-[8px] px-1.5 text-[13px] font-medium text-black/[.63] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:cursor-not-allowed disabled:opacity-40";

export interface StageCardProps {
  model: StageCardModel;
  /** Statuses (pipeline stages) of the lead's current stage; the chip's picker lists them. */
  statuses: PipelineStage[];
  statusId: string | null;
  canChangeStatus: boolean;
  onStatus: (stage: PipelineStage) => void;
  onMain: () => void;
  onRequirement: (a: RequirementAction) => void;
  /** Which requirement links this viewer may use (default: all). A link the viewer can't act on is left out, not dead. */
  actionAllowed?: (a: RequirementAction) => boolean;
  /** Wraps the "Record" link (the fee popover anchors to it). */
  wrapRecord?: (trigger: React.ReactElement) => React.ReactElement;
  onRevert: () => void;
  /** "Move to…" (admin / branch manager): the active stages with their state, and the pick handler. */
  moveOptions: PickerOption[];
  currentListId: string | null;
  onMovePick: (listId: string) => void;
  onArchive: () => void;
  /** Archived lead. */
  archived: { reason: string | null; text: string; restoreLabel: string } | null;
  onRestore: () => void;
}

export function StageCard(p: StageCardProps) {
  const { model } = p;
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveTriggerRef = useRef<HTMLButtonElement>(null);
  const status = p.statuses.find((s) => s.id === p.statusId) ?? null;
  const options: PickerOption[] = useMemo(
    () => [...p.statuses].sort((a, b) => a.position - b.position).map((s) => ({ value: s.id, label: s.name, icon: <Dot color={s.color} /> })),
    [p.statuses],
  );
  if (model.hidden) return null;

  const n = model.segments.length;
  // Weighted by label length so a long label ("Applications") gets the room it needs at 320px, with or without a classic scrollbar.
  const grid = segmentGrid(model.segments.map((s) => s.name));
  const chipLabel = p.archived
    ? `Archived${p.archived.reason ? ` · ${p.archived.reason}` : ""}`
    : [model.current?.name, status?.name].filter(Boolean).join(" · ") || "No stage";

  const chipInner = (
    <>
      <Dot color={p.archived ? "#9a9ea5" : model.current?.color ?? "#9a9ea5"} />
      <span className="max-w-[170px] truncate">{chipLabel}</span>
      {p.canChangeStatus && !p.archived && <CaretDownIcon className="size-3 text-[#9a9ea5]" />}
    </>
  );
  const chipCls = "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white pl-2 pr-1.5 text-[13px] font-medium shadow-[inset_0_0_0_1px_#e8e9eb]";

  return (
    <section aria-label="Stage" className="mx-3 rounded-[12px] p-3 shadow-[inset_0_0_0_1px_#eeeff1] max-[430px]:mx-4">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium leading-4 text-black/[.63]">Stage</span>
        <span className="flex-1" />
        {p.canChangeStatus && !p.archived ? (
          <Picker
            open={open} onOpenChange={setOpen} options={options} selected={p.statusId ? [p.statusId] : []} placeholder="Search statuses…"
            onPick={(id) => { const s = p.statuses.find((x) => x.id === id); if (s && s.id !== p.statusId) p.onStatus(s); }}
          >
            <button type="button" aria-label="Change status" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(chipCls, "outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50")}>{chipInner}</button>
          </Picker>
        ) : (
          <span className={chipCls}>{chipInner}</span>
        )}
      </div>

      {!p.archived && n > 0 && (
        <>
          <div aria-hidden className="mt-2.5 grid gap-0.5" style={{ gridTemplateColumns: grid }}>
            {model.segments.map((s) => (
              <i key={s.id} className="block h-1 rounded-[2px]" style={{ background: s.state === "done" ? "#101112" : s.state === "current" ? s.color : "#f0f1f2" }} />
            ))}
          </div>
          <ol className="m-0 mt-1.5 grid list-none gap-0.5 p-0 text-[11px] font-medium leading-[14px] tracking-[-.01em]" style={{ gridTemplateColumns: grid }}>
            {model.segments.map((s) => (
              <li key={s.id} aria-current={s.state === "current" ? "step" : undefined} className={cn("overflow-hidden text-ellipsis whitespace-nowrap", s.state === "current" ? "text-[#101112]" : "text-black/50")}>{s.name}</li>
            ))}
          </ol>
        </>
      )}

      {p.archived ? (
        <div className="mt-3 border-t border-[#f0f1f2] pt-2.5">
          <p className="m-0 text-[13px] leading-[18px] text-black/[.63]">{p.archived.text}</p>
          <button type="button" onClick={p.onRestore} className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-white text-[14px] font-medium text-[#101112] shadow-[inset_0_0_0_1px_#e8e9eb] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">
            {p.archived.restoreLabel}
          </button>
        </div>
      ) : (
        <div className="mt-3 border-t border-[#f0f1f2] pt-2.5">
          {model.next ? (
            <div className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-black/[.63]">
              <span>Next <b className="font-medium text-[#101112]">{model.nextTitle}</b></span>
              {model.progress && <span className="ml-auto text-black/50">{model.progress}</span>}
            </div>
          ) : null}
          {model.requirements.length > 0 && (
            <ul className="m-0 mt-1.5 list-none p-0">
              {model.requirements.map((r) => (
                <li key={r.id} className="flex h-7 items-center gap-2 text-[13px]">
                  {r.ok ? <CheckCircleIcon aria-label="Done" className="size-[14px] shrink-0 text-[#12805c]" /> : <CircleIcon aria-label="To do" className="size-[14px] shrink-0 text-[#b25e09]" />}
                  <span className={cn("min-w-0 flex-1 truncate", r.ok && "text-black/50")}>{r.text}</span>
                  {!r.ok && r.action && r.actionLabel && (p.actionAllowed?.(r.action) ?? true) && (() => {
                    const link = (
                      <button type="button" onClick={r.action === "record-fee" && p.wrapRecord ? undefined : () => { rememberOrigin(); p.onRequirement(r.action!); }} className="shrink-0 rounded-[4px] text-[13px] text-[#266df0] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#266df0]/50">{r.actionLabel}</button>
                    );
                    return r.action === "record-fee" && p.wrapRecord ? p.wrapRecord(link) : link;
                  })()}
                </li>
              ))}
            </ul>
          )}
          {model.hint && <div className="mt-1.5 text-[13px] leading-[18px] text-black/[.63]">{model.hint}</div>}
          {model.main.kind !== "none" ? (
            <button
              type="button"
              onClick={() => { rememberOrigin(); p.onMain(); }}
              disabled={!model.main.enabled}
              title={model.main.disabledReason ?? undefined}
              className={cn(
                "mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#266df0]/50",
                model.main.enabled ? "bg-[#266df0] text-white hover:bg-[#1d5bd0]" : "cursor-not-allowed bg-[#f0f1f2] text-black/[.38]",
              )}
            >
              {model.main.label}
              {model.main.enabled && <ArrowRightIcon className="size-[14px]" />}
            </button>
          ) : (
            model.main.label && <div className="mt-2 text-[13px] text-black/[.63]">{model.main.label}</div>
          )}
          <div className="mt-1.5 flex items-center gap-0.5">
            {model.footer.revert.show && (
              <button type="button" disabled={!model.footer.revert.enabled} title={model.footer.revert.tooltip ?? model.footer.revert.label} onClick={() => { rememberOrigin(); p.onRevert(); }} className={cn(BTN, "min-w-0 shrink")}>
                <ArrowBendUpLeftIcon className="size-3 shrink-0" /><span className="truncate">{model.footer.revert.label}</span>
              </button>
            )}
            <span className="min-w-0 flex-1" />
            {model.footer.moveTo && (
              <Picker
                open={moveOpen} onOpenChange={setMoveOpen} options={p.moveOptions} selected={p.currentListId ? [p.currentListId] : []} placeholder="Move to…"
                onPick={(id) => { if (id !== p.currentListId) { rememberOrigin(moveTriggerRef.current); p.onMovePick(id); } }}
                footer={model.footer.archive ? () => ({ label: "Archive…", icon: <ArchiveIcon className="size-[14px]" aria-hidden />, onSelect: () => { rememberOrigin(moveTriggerRef.current); p.onArchive(); } }) : undefined}
              >
                <button ref={moveTriggerRef} type="button" aria-haspopup="listbox" aria-expanded={moveOpen} onClick={() => setMoveOpen((o) => !o)} className={cn(BTN, "shrink-0")}>Move to…<CaretDownIcon className="size-3" /></button>
              </Picker>
            )}
            {model.footer.archive && (
              <button type="button" aria-label="Archive" title="Archive" onClick={() => { rememberOrigin(); p.onArchive(); }} className={cn(BTN, "w-[26px] shrink-0 justify-center px-0 [&_svg]:size-[14px]")}><ArchiveIcon /></button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
