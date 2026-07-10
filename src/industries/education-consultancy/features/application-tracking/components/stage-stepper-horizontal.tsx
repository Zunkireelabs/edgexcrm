"use client";

import { Fragment, useState } from "react";
import { Check, Trophy, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@/types/database";

interface StageStepperHorizontalProps {
  stages: ApplicationStage[];
  currentStageId: string;
  applicationId: string;
  canManage: boolean;
  onStageChange: (newStageId: string, newStatus: string) => void;
}

export function StageStepperHorizontal({
  stages,
  currentStageId,
  applicationId,
  canManage,
  onStageChange,
}: StageStepperHorizontalProps) {
  const [advancingTo, setAdvancingTo] = useState<string | null>(null);

  const currentStage = stages.find((s) => s.id === currentStageId);
  const currentPosition = currentStage?.position ?? 0;

  async function handleStageClick(stage: ApplicationStage) {
    if (!canManage) return;
    if (stage.id === currentStageId) return;
    if (advancingTo) return;

    setAdvancingTo(stage.id);
    try {
      const res = await fetch(`/api/v1/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: stage.id }),
      });
      if (!res.ok) throw new Error("Failed to update stage");

      const { data } = await res.json();
      const newStatus: string = data?.status ?? stage.slug;

      onStageChange(stage.id, newStatus);

      if (stage.terminal_type === "won") toast.success("Application enrolled!");
      else if (stage.terminal_type === "lost") toast.error("Application ended.");
    } catch {
      toast.error("Failed to update stage. Please try again.");
    } finally {
      setAdvancingTo(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max px-1 py-1">
        {/* Row 1: dots + connectors — kept in its own row (no variable-height
            label sharing the flex cross-axis) so the connector line always
            centers on the dot regardless of how long/short a stage name is
            or whether it wraps to 2 lines below. */}
        <div className="flex items-center">
          {stages.map((stage, index) => {
            const isPast = stage.position < currentPosition;
            const isCurrent = stage.id === currentStageId;
            const isLoading = advancingTo === stage.id;
            const isClickable = canManage && !isCurrent && !advancingTo;
            const isTerminalWon = stage.terminal_type === "won";
            const isTerminalLost = stage.terminal_type === "lost";

            return (
              <Fragment key={stage.id}>
                <div className="w-20 flex justify-center shrink-0">
                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => handleStageClick(stage)}
                    className={[
                      "h-7 w-7 rounded-full flex items-center justify-center shrink-0 border-2 transition-all",
                      isCurrent
                        ? "border-current text-white"
                        : isPast
                        ? "border-transparent"
                        : "border-muted text-muted-foreground bg-background",
                      isTerminalWon && isCurrent ? "border-green-600 bg-green-600" : "",
                      isTerminalLost && isCurrent ? "border-red-500 bg-red-500" : "",
                      !isTerminalWon && !isTerminalLost && isCurrent ? "border-primary bg-primary" : "",
                      isPast ? "bg-muted/60" : "",
                      isClickable ? "cursor-pointer hover:border-foreground hover:bg-muted/40" : "cursor-default",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      isPast
                        ? { backgroundColor: `${stage.color}40`, borderColor: stage.color }
                        : {}
                    }
                    title={stage.name}
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isTerminalWon && isCurrent ? (
                      <Trophy className="h-3.5 w-3.5" />
                    ) : isTerminalLost && isCurrent ? (
                      <XCircle className="h-3.5 w-3.5" />
                    ) : isPast ? (
                      <Check className="h-3.5 w-3.5" style={{ color: stage.color }} />
                    ) : isCurrent ? (
                      <span className="h-2 w-2 rounded-full bg-white" />
                    ) : null}
                  </button>
                </div>
                {index < stages.length - 1 && (
                  <div
                    className="h-0.5 w-6 shrink-0"
                    style={{
                      backgroundColor: isPast ? `${stage.color}60` : "hsl(var(--border))",
                    }}
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        {/* Row 2: labels — same w-20/w-6 column widths as row 1 so every
            label lines up under its own dot. */}
        <div className="flex items-start mt-1.5">
          {stages.map((stage, index) => {
            const isCurrent = stage.id === currentStageId;
            const isClickable = canManage && !isCurrent && !advancingTo;
            const isTerminalWon = stage.terminal_type === "won";
            const isTerminalLost = stage.terminal_type === "lost";

            return (
              <Fragment key={stage.id}>
                <div className="w-20 shrink-0">
                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => handleStageClick(stage)}
                    className={[
                      "w-full text-center leading-tight px-0.5",
                      isCurrent ? "text-[11px] font-semibold text-foreground" : "text-[10px] text-muted-foreground",
                      isClickable ? "cursor-pointer hover:text-foreground" : "cursor-default",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {stage.name}
                    {isTerminalWon && (
                      <span className="block text-[9px] font-semibold text-green-700">Enrolled</span>
                    )}
                    {isTerminalLost && (
                      <span className="block text-[9px] font-semibold text-red-700">Ended</span>
                    )}
                  </button>
                </div>
                {index < stages.length - 1 && <div className="w-6 shrink-0" />}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
