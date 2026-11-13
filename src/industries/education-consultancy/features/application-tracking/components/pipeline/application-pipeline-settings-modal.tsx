"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaretDownIcon, DotsSixVerticalIcon, DotsThreeIcon, PlusIcon } from "@/components/icons";
import { toast } from "sonner";
import {
  diffToOps,
  runSettingsOps,
  type DraftStage,
  type DraftState,
  type OpRequest,
} from "../../lib/pipeline-settings-ops";
import type { ApplicationPipelineWithCounts, ApplicationStage } from "@/types/database";

interface ApplicationPipelineSettingsModalProps {
  open: boolean;
  onClose: () => void;
  pipeline: ApplicationPipelineWithCounts;
  /** This pipeline's stages as the workspace already has them: the modal opens with them (no empty first paint). */
  stages: ApplicationStage[];
  /** Placement-based application count per stage id (matches the board). Falls back to the API's count. */
  stageAppCounts?: Record<string, number>;
  /** Open with the "add stage" row ready (the board's add-stage box). */
  startAddingStage?: boolean;
}

const PALETTE = [
  "#9aa4b2", "#3b82f6", "#0ea5e9", "#14b8a6", "#22c55e", "#16a34a",
  "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1",
];

const isFinished = (s: DraftStage) => s.is_terminal || s.terminal_type != null;

const toDraftStage = (s: ApplicationStage): DraftStage => ({
  key: s.id, name: s.name, color: s.color, is_default: s.is_default, is_terminal: s.is_terminal, terminal_type: s.terminal_type,
});
const toDraft = (name: string, is_default: boolean, stages: ApplicationStage[]): DraftState => ({
  name, is_default, stages: [...stages].sort((a, b) => a.position - b.position).map(toDraftStage),
});

type StagePatch = Partial<Pick<DraftStage, "name" | "color" | "is_default" | "is_terminal" | "terminal_type">>;

function StageRow({
  stage,
  count,
  onPatch,
  onDelete,
}: {
  stage: DraftStage;
  count: number;
  onPatch: (s: DraftStage, patch: StagePatch) => void;
  onDelete: (s: DraftStage) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.key });
  const [name, setName] = useState(stage.name);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const finished = isFinished(stage);

  const commitName = () => {
    const next = name.trim();
    if (!next) return setName(stage.name);
    if (next !== stage.name) onPatch(stage, { name: next });
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      data-testid="settings-stage-row"
      className="group relative flex h-[38px] items-center gap-2 rounded-[9px] pr-1.5 pl-1 hover:bg-[#f6f7f9]"
    >
      <button type="button" aria-label="Reorder stage" className="h-4 w-4 cursor-grab text-[#d0d3d7]" {...attributes} {...listeners}>
        <DotsSixVerticalIcon className="h-4 w-4" />
      </button>

      <button
        type="button"
        aria-label="Stage colour"
        onClick={() => setPaletteOpen((o) => !o)}
        className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] hover:bg-black/[.06]"
      >
        <i className="block h-[10px] w-[10px] rounded-full" style={{ background: stage.color }} />
      </button>
      {paletteOpen && (
        <div className="absolute top-9 left-6 z-10 w-[212px] rounded-[12px] bg-white p-2.5 shadow-[0_10px_15px_-3px_rgb(0_0_0/.1),0_0_0_1px_rgba(0,0,0,.06)]">
          <div className="grid grid-cols-6 gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  setPaletteOpen(false);
                  if (c !== stage.color) onPatch(stage, { color: c });
                }}
                className={`h-6 w-6 rounded-full ${c === stage.color ? "shadow-[0_0_0_2px_#fff,0_0_0_4px_#101112]" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setName(stage.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        maxLength={100}
        aria-label="Stage name"
        className="h-7 min-w-0 flex-1 rounded-[6px] bg-transparent px-1.5 text-[13px] font-medium text-[#101112] outline-none hover:bg-white hover:shadow-[inset_0_0_0_1px_#e8e9eb] focus:bg-white focus:shadow-[inset_0_0_0_1px_#2272B4]"
      />

      {stage.is_default ? (
        <span className="inline-flex h-5 items-center rounded-[6px] bg-[#eaf2fa] px-[7px] text-[11px] font-medium text-[#2272B4]">Start</span>
      ) : (
        !finished && (
          <button
            type="button"
            onClick={() => onPatch(stage, { is_default: true })}
            className="hidden text-[11px] text-[#9a9ea5] group-hover:inline hover:text-[#101112]"
          >
            Set as start
          </button>
        )
      )}

      {finished && (
        <span className="relative">
          <select
            aria-label="Outcome"
            value={stage.terminal_type ?? ""}
            onChange={(e) => onPatch(stage, { terminal_type: (e.target.value || null) as "won" | "lost" | null })}
            className={`h-6 appearance-none rounded-[6px] bg-white pr-5 pl-2 text-[12px] font-medium shadow-[inset_0_0_0_1px_#e8e9eb] ${
              stage.terminal_type === "lost" ? "text-[#b42318]" : "text-[#127a4a]"
            }`}
          >
            {!stage.terminal_type && <option value="">Choose…</option>}
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
          <CaretDownIcon className="pointer-events-none absolute top-1/2 right-1.5 h-3 w-3 -translate-y-1/2 text-[#9a9ea5]" />
        </span>
      )}

      <span className="w-16 text-right text-[12px] text-[#9a9ea5] tabular-nums">{count} apps</span>

      <div className="relative">
        <button
          type="button"
          aria-label="Stage options"
          onClick={() => setMenuOpen((o) => !o)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[#9a9ea5] opacity-0 group-hover:opacity-100 hover:bg-black/5 focus:opacity-100"
        >
          <DotsThreeIcon className="h-[14px] w-[14px]" />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 z-10 w-48 rounded-[12px] bg-white p-1 shadow-[0_10px_15px_-3px_rgb(0_0_0/.1),0_0_0_1px_rgba(0,0,0,.06)]">
            <button
              type="button"
              className="flex h-[30px] w-full items-center rounded-[8px] px-2 text-[13px] hover:bg-[#f6f7f9]"
              onClick={() => {
                setMenuOpen(false);
                onPatch(stage, finished ? { terminal_type: null } : { is_terminal: true, terminal_type: "won" });
              }}
            >
              {finished ? "Move to Active" : "Move to Finished"}
            </button>
            <button
              type="button"
              className="flex h-[30px] w-full items-center rounded-[8px] px-2 text-[13px] text-[#b42318] hover:bg-[#f6f7f9]"
              onClick={() => {
                setMenuOpen(false);
                onDelete(stage);
              }}
            >
              Delete stage…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ApplicationPipelineSettingsModal({
  open,
  onClose,
  pipeline,
  stages: stagesProp,
  stageAppCounts,
  startAddingStage,
}: ApplicationPipelineSettingsModalProps) {
  // Everything below edits a local draft; nothing reaches the API until "Save changes".
  const [original, setOriginal] = useState<DraftState>(() => toDraft(pipeline.name, pipeline.is_default, stagesProp));
  const [draft, setDraft] = useState<DraftState>(original);
  const [isSaving, setIsSaving] = useState(false);
  const [adding, setAdding] = useState(!!startAddingStage);
  const [newName, setNewName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<DraftStage | null>(null);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [deletePipelineAsk, setDeletePipelineAsk] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);
  const newCounter = useRef(0);

  const ops = useMemo(() => diffToOps(original, draft), [original, draft]);
  const dirty = ops.length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const base = `/api/v1/application-pipelines/${pipeline.id}`;

  const countOf = (s: DraftStage) => stageAppCounts?.[s.key] ?? 0;

  const request: OpRequest = async (method, path, body) => {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  };

  /** Refresh from the server. Replaces the draft too unless the user has unsaved edits (or `force`). */
  const refresh = async (force = false) => {
    try {
      const res = await fetch(base);
      const json = await res.json();
      if (!json.data) return;
      const fresh = toDraft(json.data.name, json.data.is_default, json.data.stages ?? []);
      setOriginal(fresh);
      if (force || !dirtyRef.current) setDraft(fresh);
    } catch {
      /* keep the props-seeded draft */
    }
  };

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pipeline.id]);

  useEffect(() => {
    if (adding) newInputRef.current?.focus();
  }, [adding]);

  const active = draft.stages.filter((s) => !isFinished(s));
  const finished = draft.stages.filter(isFinished);

  const updateStage = (stage: DraftStage, patch: StagePatch) =>
    setDraft((d) => ({
      ...d,
      stages: d.stages.map((s) => {
        if (s.key === stage.key) {
          const next = { ...s, ...patch };
          if (patch.terminal_type === null) next.is_terminal = false;
          else if (patch.terminal_type) next.is_terminal = true;
          return next;
        }
        return patch.is_default ? { ...s, is_default: false } : s;
      }),
    }));

  const reorderGroup = (group: DraftStage[], event: DragEndEvent) => {
    const { active: a, over } = event;
    if (!over || a.id === over.id) return;
    const moved = arrayMove(
      group,
      group.findIndex((s) => s.key === a.id),
      group.findIndex((s) => s.key === over.id),
    );
    setDraft((d) => ({ ...d, stages: group === active ? [...moved, ...finished] : [...active, ...moved] }));
  };

  const addStage = () => {
    const n = newName.trim();
    if (!n) return;
    const stage: DraftStage = {
      key: `new:${++newCounter.current}`, name: n, color: "#3b82f6", is_default: false, is_terminal: false, terminal_type: null,
    };
    setDraft((d) => ({ ...d, stages: [...d.stages, stage] }));
    setNewName("");
    setAdding(false);
  };

  const removeStage = (stage: DraftStage) => {
    setDraft((d) => ({ ...d, stages: d.stages.filter((s) => s.key !== stage.key) }));
    setDeleteConfirm(null);
  };

  const requestClose = () => {
    if (isSaving) return;
    if (dirty) setDiscardAsk(true);
    else onClose();
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error("Pipeline name is required");
      return;
    }
    if (!dirty) return onClose();
    setIsSaving(true);
    const result = await runSettingsOps(ops, pipeline.id, request);
    if (result.ok) {
      toast.success("Pipeline updated");
      setIsSaving(false);
      onClose();
      return;
    }
    toast.error(`Couldn't save: ${result.failed.label}. ${result.message}`);
    await refresh(true); // show what the server actually has; the modal stays open
    setIsSaving(false);
  };

  const handleDeletePipeline = async () => {
    setDeletePipelineAsk(false);
    try {
      const res = await request("DELETE", base);
      if (!res.ok) throw new Error((res.json as { error?: { message?: string } } | null)?.error?.message || "Failed to delete");
      toast.success("Pipeline deleted");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete pipeline");
    }
  };

  const pipelineAppCount = original.stages.reduce((n, s) => n + countOf(s), 0);
  const hasRequiredTerminals =
    finished.some((s) => s.terminal_type === "won") && finished.some((s) => s.terminal_type === "lost");
  const deleteCount = deleteConfirm ? countOf(deleteConfirm) : 0;

  const group = (label: string, list: DraftStage[]) => (
    <>
      <div className="my-3 mb-1.5 flex items-center gap-2 text-[11.5px] text-[#6b6f76] after:h-px after:flex-1 after:bg-[#f0f1f2]">
        <b className="font-semibold text-[#2b2d2f]">{label}</b>
        {list.length}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => reorderGroup(list, e)}>
        <SortableContext items={list.map((s) => s.key)} strategy={verticalListSortingStrategy}>
          {list.map((s) => (
            <StageRow key={`${s.key}:${s.name}`} stage={s} count={countOf(s)} onPatch={updateStage} onDelete={setDeleteConfirm} />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
        <DialogContent className="max-h-[calc(100vh-64px)] sm:max-w-[640px] flex flex-col overflow-hidden" data-testid="pipeline-settings-modal">
          <DialogHeader>
            <DialogTitle>Pipeline settings</DialogTitle>
            <DialogDescription>{pipeline.name}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {(
              <>
                <div className="mb-3.5 flex flex-col gap-1.5">
                  <label htmlFor="app-pipeline-settings-name" className="text-[12px] font-medium text-[#6b6f76]">
                    Name
                  </label>
                  <Input id="app-pipeline-settings-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                </div>

                <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_#e8e9eb]">
                  <span className="flex-1">
                    <b className="block text-[13px] font-medium text-[#101112]">Default pipeline</b>
                    <span className="text-[12px] text-[#6b6f76]">New applications and ones with no pipeline land here.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.is_default}
                    disabled={pipeline.is_default}
                    onChange={(e) => setDraft((d) => ({ ...d, is_default: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </label>

                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-[#101112]">
                    Stages <span className="font-normal text-[#9a9ea5]">{draft.stages.length}</span>
                  </h3>
                </div>

                {group("Active", active)}
                {adding && (
                  <div className="mt-1 flex items-center gap-2 pl-6">
                    <input
                      ref={newInputRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addStage();
                        if (e.key === "Escape") setAdding(false);
                      }}
                      placeholder="New stage name"
                      maxLength={100}
                      className="h-7 flex-1 rounded-[6px] bg-white px-2 text-[13px] shadow-[inset_0_0_0_1px_#2272B4] outline-none"
                    />
                    <Button size="sm" onClick={addStage} disabled={!newName.trim()}>
                      Add
                    </Button>
                  </div>
                )}
                {finished.length > 0 && group("Finished", finished)}

                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-1 flex h-[34px] w-full items-center gap-2 rounded-[9px] border border-dashed border-[#e8e9eb] px-2.5 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f6f7f9] hover:text-[#101112]"
                >
                  <PlusIcon className="h-[14px] w-[14px]" />
                  Add stage
                </button>

                <p className="mt-3 rounded-[8px] bg-[#fafaf9] px-2.5 py-2 text-[12px] leading-relaxed text-[#6b6f76] shadow-[0_0_0_1px_rgba(0,0,0,.06)]">
                  Deleting a stage with applications asks you to move them first.
                  {!hasRequiredTerminals && " A pipeline should have at least one Won and one Lost finished stage."}
                </p>
              </>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setDeletePipelineAsk(true)}
              disabled={pipeline.is_default || pipelineAppCount > 0}
              title={
                pipeline.is_default
                  ? "The default pipeline can't be deleted"
                  : pipelineAppCount > 0
                    ? "Move its applications out first"
                    : undefined
              }
              className="mr-auto text-[13px] font-medium text-[#b42318] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete pipeline
            </button>
            <Button type="button" variant="outline" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving || !dirty}>
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteConfirm && (
        <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Delete {deleteConfirm.name}?</DialogTitle>
              <DialogDescription>
                {deleteCount > 0
                  ? `Move the ${deleteCount} ${deleteCount === 1 ? "application" : "applications"} out of ${deleteConfirm.name} first.`
                  : "This stage is empty. Deleting it can't be undone."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                {deleteCount > 0 ? "OK" : "Cancel"}
              </Button>
              {deleteCount === 0 && (
                <Button variant="destructive" onClick={() => removeStage(deleteConfirm)}>
                  Delete stage
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={discardAsk} onOpenChange={setDiscardAsk}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>You have unsaved pipeline edits. Closing now throws them away.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardAsk(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardAsk(false);
                onClose();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePipelineAsk} onOpenChange={setDeletePipelineAsk}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete {pipeline.name}?</DialogTitle>
            <DialogDescription>This removes the pipeline and its stages. It can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePipelineAsk(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeletePipeline}>
              Delete pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
