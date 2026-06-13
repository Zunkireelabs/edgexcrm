"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { GripVertical, Pencil, Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { DealStageEditor } from "./deal-stage-editor";
import type { DealPipelineWithCounts, DealStageWithCount } from "@/types/database";

interface DealPipelineSettingsModalProps {
  open: boolean;
  onClose: () => void;
  pipeline: DealPipelineWithCounts;
}

function SortableStageItem({
  stage,
  onEdit,
  onDelete,
}: {
  stage: DealStageWithCount;
  onEdit: (s: DealStageWithCount) => void;
  onDelete: (s: DealStageWithCount) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 p-2 bg-background border rounded-lg group">
      <button type="button" className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
      <span className="flex-1 text-sm font-medium">{stage.name}</span>
      <div className="flex items-center gap-1.5">
        {stage.is_default && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Default</span>
        )}
        {stage.is_terminal && stage.terminal_type === "won" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">Won</span>
        )}
        {stage.is_terminal && stage.terminal_type === "lost" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Lost</span>
        )}
        {stage.deal_count > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{stage.deal_count} deals</span>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => onEdit(stage)}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onDelete(stage)}
          disabled={stage.deal_count > 0}
          title={stage.deal_count > 0 ? "Cannot delete stage with deals" : "Delete stage"}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function DealPipelineSettingsModal({ open, onClose, pipeline }: DealPipelineSettingsModalProps) {
  const [name, setName] = useState(pipeline.name);
  const [isDefault, setIsDefault] = useState(pipeline.is_default);
  const [stages, setStages] = useState<DealStageWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingStage, setEditingStage] = useState<DealStageWithCount | null>(null);
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DealStageWithCount | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fetchDetails = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}`);
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
    if (open) fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pipeline.id]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    const newStages = arrayMove(stages, oldIndex, newIndex);
    setStages(newStages);
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}/stages/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_ids: newStages.map((s) => s.id) }),
      });
      if (!res.ok) throw new Error("Failed to reorder");
    } catch {
      toast.error("Failed to save stage order");
      fetchDetails();
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Pipeline name is required"); return; }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), is_default: isDefault }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to save");
      toast.success("Pipeline updated");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save pipeline");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePipeline = async () => {
    if (pipeline.is_default) { toast.error("Cannot delete the default pipeline"); return; }
    if (pipeline.deal_count > 0) { toast.error(`Cannot delete pipeline with ${pipeline.deal_count} deals`); return; }
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to delete");
      }
      toast.success("Pipeline deleted");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete pipeline");
    }
  };

  const handleStageEditSave = async (stageData: {
    name: string; color: string; is_terminal: boolean; terminal_type: string | null; is_default: boolean;
  }) => {
    if (!editingStage) return;
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}/stages/${editingStage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stageData),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to update stage");
      }
      toast.success("Stage updated");
      setEditingStage(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update stage");
    }
  };

  const handleAddStage = async (stageData: {
    name: string; color: string; is_terminal: boolean; terminal_type: string | null; is_default: boolean;
  }) => {
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stageData),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to add stage");
      }
      toast.success("Stage added");
      setIsAddingStage(false);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add stage");
    }
  };

  const handleDeleteStage = async (stage: DealStageWithCount) => {
    try {
      const res = await fetch(`/api/v1/deal-pipelines/${pipeline.id}/stages/${stage.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to delete stage");
      }
      toast.success("Stage deleted");
      setDeleteConfirm(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete stage");
    }
  };

  const wonStages = stages.filter((s) => s.terminal_type === "won");
  const lostStages = stages.filter((s) => s.terminal_type === "lost");
  const hasRequiredTerminals = wonStages.length >= 1 && lostStages.length >= 1;

  return (
    <>
      <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Pipeline Settings</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="deal-pipeline-settings-name">Pipeline Name</Label>
                  <Input id="deal-pipeline-settings-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="deal-is-default"
                    checked={isDefault}
                    onCheckedChange={(checked) => setIsDefault(!!checked)}
                  />
                  <Label htmlFor="deal-is-default" className="font-normal cursor-pointer">
                    Set as default pipeline
                  </Label>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Stages</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsAddingStage(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Stage
                    </Button>
                  </div>

                  {!hasRequiredTerminals && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Pipeline must have at least one &quot;Won&quot; and one &quot;Lost&quot; stage.</span>
                    </div>
                  )}

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {stages.map((stage) => (
                          <SortableStageItem key={stage.id} stage={stage} onEdit={setEditingStage} onDelete={setDeleteConfirm} />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>

                  {stages.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No stages yet. Add your first stage.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 border-t pt-4">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeletePipeline}
              disabled={pipeline.is_default || pipeline.deal_count > 0}
              className="sm:mr-auto"
            >
              Delete Pipeline
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingStage && (
        <DealStageEditor
          open={!!editingStage}
          onClose={() => setEditingStage(null)}
          onSave={handleStageEditSave}
          stage={editingStage}
          mode="edit"
        />
      )}

      {isAddingStage && (
        <DealStageEditor
          open={isAddingStage}
          onClose={() => setIsAddingStage(false)}
          onSave={handleAddStage}
          mode="add"
        />
      )}

      {deleteConfirm && (
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Delete Stage</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-4">
              Are you sure you want to delete the stage &quot;{deleteConfirm.name}&quot;? This action cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleDeleteStage(deleteConfirm)}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
