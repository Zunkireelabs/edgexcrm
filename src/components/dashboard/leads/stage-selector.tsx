"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown, Check } from "lucide-react";
import type { PipelineStage } from "@/types/database";

interface StageSelectorProps {
  currentStageId: string | null;
  /** Stages of THIS lead's pipeline (caller filters by pipeline_id). */
  stages: PipelineStage[];
  onChange: (stageId: string) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Inline stage editor for the leads table — mirrors MoveToListSelector's popover
 * pattern. The trigger renders as the stage badge; clicking opens the stage list.
 * Gating (canEditLeads) is decided by the caller (only rendered when editable).
 */
export function StageSelector({
  currentStageId,
  stages,
  onChange,
  disabled = false,
}: StageSelectorProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = stages.find((s) => s.id === currentStageId);

  async function handlePick(stageId: string) {
    if (stageId === currentStageId) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onChange(stageId);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled || saving}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[8px] text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          style={
            current
              ? { backgroundColor: `${current.color}20`, color: current.color }
              : { backgroundColor: "#f3f4f6", color: "#6b7280" }
          }
        >
          <span className="whitespace-nowrap">{current?.name ?? "Set stage"}</span>
          <ChevronDown className="w-3 h-3 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-48 p-1" align="start">
        <p className="text-[10px] font-medium text-gray-400 px-2 py-1 uppercase tracking-wide">
          Stage
        </p>
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            onClick={() => handlePick(stage.id)}
            className="w-full text-left flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            <Check
              className={`w-3 h-3 shrink-0 ${
                stage.id === currentStageId ? "text-blue-600" : "opacity-0"
              }`}
            />
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: stage.color }}
            />
            <span className="text-gray-700">{stage.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
