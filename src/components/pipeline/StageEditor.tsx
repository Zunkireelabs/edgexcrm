"use client";

import { useState } from "react";
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
import type { PipelineStageWithCount } from "@/types/database";

interface StageEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    color: string;
    is_terminal: boolean;
    terminal_type: string | null;
    is_default: boolean;
  }) => void;
  stage?: PipelineStageWithCount;
  mode: "edit" | "add";
}

const STAGE_COLORS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Yellow", value: "#eab308" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "Gray", value: "#6b7280" },
];

export function StageEditor({
  open,
  onClose,
  onSave,
  stage,
  mode,
}: StageEditorProps) {
  const [name, setName] = useState(stage?.name || "");
  const [color, setColor] = useState(stage?.color || "#3b82f6");
  const [stageType, setStageType] = useState<"regular" | "won" | "lost">(
    stage?.terminal_type === "won"
      ? "won"
      : stage?.terminal_type === "lost"
      ? "lost"
      : "regular"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        color,
        is_terminal: stageType !== "regular",
        terminal_type: stageType === "regular" ? null : stageType,
        is_default: false, // Don't change default status from editor
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName(stage?.name || "");
    setColor(stage?.color || "#3b82f6");
    setStageType(
      stage?.terminal_type === "won"
        ? "won"
        : stage?.terminal_type === "lost"
        ? "lost"
        : "regular"
    );
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add Stage" : "Edit Stage"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Stage Name */}
          <div className="space-y-2">
            <Label htmlFor="stage-name">Stage Name</Label>
            <Input
              id="stage-name"
              placeholder="e.g., Discovery Call"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Color Selection */}
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {STAGE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === c.value
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Stage Type */}
          <div className="space-y-2">
            <Label>Stage Type</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="stage-type"
                  value="regular"
                  checked={stageType === "regular"}
                  onChange={() => setStageType("regular")}
                  className="h-4 w-4"
                />
                <span className="text-sm">Regular stage</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="stage-type"
                  value="won"
                  checked={stageType === "won"}
                  onChange={() => setStageType("won")}
                  className="h-4 w-4"
                />
                <span className="text-sm flex items-center gap-2">
                  Won
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                    Terminal
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="stage-type"
                  value="lost"
                  checked={stageType === "lost"}
                  onChange={() => setStageType("lost")}
                  className="h-4 w-4"
                />
                <span className="text-sm flex items-center gap-2">
                  Lost
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                    Terminal
                  </span>
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Terminal stages mark leads as converted (won) or closed (lost).
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? "Saving..." : mode === "add" ? "Add Stage" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
