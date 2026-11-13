"use client";

import { useState, useEffect, useRef } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaretDownIcon, DotsSixVerticalIcon, DotsThreeIcon, PlusIcon } from "@/components/icons";
import { toast } from "sonner";
import type { ApplicationPipelineWithCounts, ApplicationStageWithCount } from "@/types/database";

interface ApplicationPipelineSettingsModalProps {
  open: boolean;
  onClose: () => void;
  pipeline: ApplicationPipelineWithCounts;
  /** Placement-based application count per stage id (matches the board). Falls back to the API's count. */
  stageAppCounts?: Record<string, number>;
  /** Open with the "add stage" row ready (the board's add-stage box). */
  startAddingStage?: boolean;
}

const PALETTE = [
  "#9aa4b2", "#3b82f6", "#0ea5e9", "#14b8a6", "#22c55e", "#16a34a",
  "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1",
];

const isFinished = (s: ApplicationStageWithCount) => s.is_terminal || s.terminal_type != null;

type StagePatch = Partial<{ name: string; color: string; is_default: boolean; is_terminal: boolean; terminal_type: "won" | "lost" | null }>;

function StageRow({
  stage,
  count,
  onPatch,
  onDelete,
}: {
  stage: ApplicationStageWithCount;
  count: number;
  onPatch: (s: ApplicationStageWithCount, patch: StagePatch) => void;
  onDelete: (s: ApplicationStageWithCount) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
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
  stageAppCounts,
  startAddingStage,
}: ApplicationPipelineSettingsModalProps) {
  const [name, setName] = useState(pipeline.name);
  const [isDefault, setIsDefault] = useState(pipeline.is_default);
  const [stages, setStages] = useState<ApplicationStageWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [adding, setAdding] = useState(!!startAddingStage);
  const [newName, setNewName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<ApplicationStageWithCount | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const base = `/api/v1/application-pipelines/${pipeline.id}`;

  const countOf = (s: ApplicationStageWithCount) => stageAppCounts?.[s.id] ?? s.application_count ?? 0;

  const fetchDetails = async () => {
    try {
      const res = await fetch(base);
      const json = await res.json();
      if (json.data) {
        setName(json.data.name);
        setIsDefault(json.data.is_default);
        setStages(json.data.stages || []);
      }
    } catch {
      toast.error("Failed to load pipeline details");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) void fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pipeline.id]);

  useEffect(() => {
    if (adding) newInputRef.current?.focus();
  }, [adding, isLoading]);

  const active = stages.filter((s) => !isFinished(s));
  const finished = stages.filter(isFinished);

  const patchStage = async (stage: ApplicationStageWithCount, patch: StagePatch) => {
    try {
      const res = await fetch(`${base}/stages/${stage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || "Failed to update stage");
      }
      await fetchDetails();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update stage");
      void fetchDetails();
    }
  };

  const reorderGroup = async (group: ApplicationStageWithCount[], event: DragEndEvent) => {
    const { active: a, over } = event;
    if (!over || a.id === over.id) return;
    const moved = arrayMove(
      group,
      group.findIndex((s) => s.id === a.id),
      group.findIndex((s) => s.id === over.id),
    );
    const next = group === active ? [...moved, ...finished] : [...active, ...moved];
    setStages(next);
    try {
      const res = await fetch(`${base}/stages/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_ids: next.map((s) => s.id) }),
      });
      if (!res.ok) throw new Error("Failed to reorder");
    } catch {
      toast.error("Failed to save stage order");
      void fetchDetails();
    }
  };

  const addStage = async () => {
    const n = newName.trim();
    if (!n) return;
    try {
      const res = await fetch(`${base}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, color: "#3b82f6", is_terminal: false, terminal_type: null, is_default: false }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || "Failed to add stage");
      }
      setNewName("");
      setAdding(false);
      toast.success("Stage added");
      await fetchDetails();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add stage");
    }
  };

  const deleteStage = async (stage: ApplicationStageWithCount) => {
    try {
      const res = await fetch(`${base}/stages/${stage.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(res.status === 409 ? `Move the applications out of ${stage.name} first` : json?.error?.message || "Failed to delete stage");
      }
      toast.success("Stage deleted");
      setDeleteConfirm(null);
      await fetchDetails();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete stage");
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Pipeline name is required");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), is_default: isDefault }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to save");
      toast.success("Pipeline updated");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save pipeline");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePipeline = async () => {
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || "Failed to delete");
      }
      toast.success("Pipeline deleted");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete pipeline");
    }
  };

  const hasRequiredTerminals =
    finished.some((s) => s.terminal_type === "won") && finished.some((s) => s.terminal_type === "lost");
  const deleteCount = deleteConfirm ? countOf(deleteConfirm) : 0;

  const group = (label: string, list: ApplicationStageWithCount[]) => (
    <>
      <div className="my-3 mb-1.5 flex items-center gap-2 text-[11.5px] text-[#6b6f76] after:h-px after:flex-1 after:bg-[#f0f1f2]">
        <b className="font-semibold text-[#2b2d2f]">{label}</b>
        {list.length}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => reorderGroup(list, e)}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {list.map((s) => (
            <StageRow key={`${s.id}:${s.name}`} stage={s} count={countOf(s)} onPatch={patchStage} onDelete={setDeleteConfirm} />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[calc(100vh-64px)] sm:max-w-[640px] flex flex-col overflow-hidden" data-testid="pipeline-settings-modal">
          <DialogHeader>
            <DialogTitle>Pipeline settings</DialogTitle>
            <DialogDescription>{pipeline.name}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <>
                <div className="mb-3.5 flex flex-col gap-1.5">
                  <label htmlFor="app-pipeline-settings-name" className="text-[12px] font-medium text-[#6b6f76]">
                    Name
                  </label>
                  <Input id="app-pipeline-settings-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_#e8e9eb]">
                  <span className="flex-1">
                    <b className="block text-[13px] font-medium text-[#101112]">Default pipeline</b>
                    <span className="text-[12px] text-[#6b6f76]">New applications and ones with no pipeline land here.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={isDefault}
                    disabled={pipeline.is_default}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="h-4 w-4"
                  />
                </label>

                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-[#101112]">
                    Stages <span className="font-normal text-[#9a9ea5]">{stages.length}</span>
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
                        if (e.key === "Enter") void addStage();
                        if (e.key === "Escape") setAdding(false);
                      }}
                      placeholder="New stage name"
                      maxLength={100}
                      className="h-7 flex-1 rounded-[6px] bg-white px-2 text-[13px] shadow-[inset_0_0_0_1px_#2272B4] outline-none"
                    />
                    <Button size="sm" onClick={() => void addStage()} disabled={!newName.trim()}>
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
              onClick={handleDeletePipeline}
              disabled={pipeline.is_default || pipeline.application_count > 0}
              title={
                pipeline.is_default
                  ? "The default pipeline can't be deleted"
                  : pipeline.application_count > 0
                    ? "Move its applications out first"
                    : undefined
              }
              className="mr-auto text-[13px] font-medium text-[#b42318] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete pipeline
            </button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
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
                <Button variant="destructive" onClick={() => void deleteStage(deleteConfirm)}>
                  Delete stage
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
