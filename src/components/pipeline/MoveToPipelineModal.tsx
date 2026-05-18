"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { PipelineLead } from "@/types/database";

interface PipelineOption {
  id: string;
  name: string;
  is_default: boolean;
}

interface StageOption {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: string | null;
}

const STAGE_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#a855f7", "#ec4899", "#6b7280",
];

interface MoveToPipelineModalProps {
  open: boolean;
  onClose: () => void;
  lead: PipelineLead;
  currentPipelineId: string;
  onMoved: (leadId: string) => void;
}

export function MoveToPipelineModal({
  open,
  onClose,
  lead,
  currentPipelineId,
  onMoved,
}: MoveToPipelineModalProps) {
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [isLoadingPipelines, setIsLoadingPipelines] = useState(true);
  const [isLoadingStages, setIsLoadingStages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline create pipeline state
  const [showCreatePipeline, setShowCreatePipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [isCreatingPipeline, setIsCreatingPipeline] = useState(false);

  // Inline create stage state
  const [showCreateStage, setShowCreateStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#3b82f6");
  const [isCreatingStage, setIsCreatingStage] = useState(false);

  // Fetch pipelines when modal opens
  useEffect(() => {
    if (!open) return;

    setIsLoadingPipelines(true);
    setSelectedPipelineId("");
    setSelectedStageId("");
    setStages([]);
    setShowCreatePipeline(false);
    setShowCreateStage(false);
    setNewPipelineName("");
    setNewStageName("");

    fetch("/api/v1/pipelines")
      .then((res) => res.json())
      .then((json) => {
        const available = (json.data || []).filter(
          (p: PipelineOption) => p.id !== currentPipelineId
        );
        setPipelines(available);
      })
      .catch(() => toast.error("Failed to load pipelines"))
      .finally(() => setIsLoadingPipelines(false));
  }, [open, currentPipelineId]);

  // Fetch stages when a pipeline is selected
  useEffect(() => {
    if (!selectedPipelineId) {
      setStages([]);
      setSelectedStageId("");
      return;
    }

    setIsLoadingStages(true);
    setShowCreateStage(false);
    setNewStageName("");

    fetch(`/api/v1/pipelines/${selectedPipelineId}`)
      .then((res) => res.json())
      .then((json) => {
        const pipelineStages: StageOption[] = json.data?.stages || [];
        setStages(pipelineStages);

        // Auto-select default stage, or first non-terminal stage
        const defaultStage = pipelineStages.find((s) => s.is_default);
        const firstNonTerminal = pipelineStages.find((s) => !s.is_terminal);
        const autoSelect = defaultStage || firstNonTerminal || pipelineStages[0];
        setSelectedStageId(autoSelect?.id || "");
      })
      .catch(() => toast.error("Failed to load stages"))
      .finally(() => setIsLoadingStages(false));
  }, [selectedPipelineId]);

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) return;

    setIsCreatingPipeline(true);
    try {
      const res = await fetch("/api/v1/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPipelineName.trim(),
          template: "default",
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to create pipeline");
      }

      const newPipeline: PipelineOption = {
        id: json.data.id,
        name: json.data.name,
        is_default: json.data.is_default,
      };

      setPipelines((prev) => [...prev, newPipeline]);
      setSelectedPipelineId(newPipeline.id);
      setShowCreatePipeline(false);
      setNewPipelineName("");
      toast.success(`Pipeline "${newPipeline.name}" created`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create pipeline"
      );
    } finally {
      setIsCreatingPipeline(false);
    }
  };

  const handleCreateStage = async () => {
    if (!newStageName.trim() || !selectedPipelineId) return;

    setIsCreatingStage(true);
    try {
      const res = await fetch(
        `/api/v1/pipelines/${selectedPipelineId}/stages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newStageName.trim(),
            color: newStageColor,
          }),
        }
      );

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to create stage");
      }

      const newStage: StageOption = {
        id: json.data.id,
        name: json.data.name,
        color: json.data.color,
        is_default: json.data.is_default,
        is_terminal: json.data.is_terminal,
        terminal_type: json.data.terminal_type,
      };

      setStages((prev) => [...prev, newStage]);
      setSelectedStageId(newStage.id);
      setShowCreateStage(false);
      setNewStageName("");
      setNewStageColor("#3b82f6");
      toast.success(`Stage "${newStage.name}" created`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create stage"
      );
    } finally {
      setIsCreatingStage(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedPipelineId || !selectedStageId) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_id: selectedPipelineId,
          stage_id: selectedStageId,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to move lead");
      }

      const targetPipeline = pipelines.find((p) => p.id === selectedPipelineId);
      const targetStage = stages.find((s) => s.id === selectedStageId);
      toast.success(
        `Moved to ${targetPipeline?.name} → ${targetStage?.name}`
      );
      onMoved(lead.id);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to move lead"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const leadName =
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "This lead";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Move to Pipeline</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Move <span className="font-medium text-foreground">{leadName}</span>{" "}
            to a different pipeline.
          </p>

          {/* Pipeline Selector */}
          <div className="space-y-2">
            <Label>Target Pipeline</Label>
            {isLoadingPipelines ? (
              <div className="h-9 bg-muted rounded-md animate-pulse" />
            ) : showCreatePipeline ? (
              <div className="flex items-center gap-2">
                <Input
                  placeholder="New pipeline name"
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreatePipeline();
                    }
                  }}
                  autoFocus
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleCreatePipeline}
                  disabled={!newPipelineName.trim() || isCreatingPipeline}
                >
                  {isCreatingPipeline ? "..." : "Add"}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setShowCreatePipeline(false);
                    setNewPipelineName("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Select
                  value={selectedPipelineId}
                  onValueChange={setSelectedPipelineId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.is_default ? " (Default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => setShowCreatePipeline(true)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create new pipeline
                </button>
              </div>
            )}
          </div>

          {/* Stage Selector */}
          {selectedPipelineId && (
            <div className="space-y-2">
              <Label>Target Stage</Label>
              {isLoadingStages ? (
                <div className="h-9 bg-muted rounded-md animate-pulse" />
              ) : showCreateStage ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="New stage name"
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateStage();
                        }
                      }}
                      autoFocus
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={handleCreateStage}
                      disabled={!newStageName.trim() || isCreatingStage}
                    >
                      {isCreatingStage ? "..." : "Add"}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        setShowCreateStage(false);
                        setNewStageName("");
                        setNewStageColor("#3b82f6");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {STAGE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewStageColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          newStageColor === c
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Select
                    value={selectedStageId}
                    onValueChange={setSelectedStageId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: s.color }}
                            />
                            {s.name}
                            {s.is_terminal && s.terminal_type
                              ? ` (${s.terminal_type})`
                              : ""}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setShowCreateStage(true)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create new stage
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedPipelineId || !selectedStageId || isSubmitting}
          >
            {isSubmitting ? "Moving..." : "Move Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
