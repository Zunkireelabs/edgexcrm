"use client";

import { useState } from "react";
import { Check, Trophy, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@/types/database";

interface StageStepperProps {
  stages: ApplicationStage[];
  currentStageId: string;
  applicationId: string;
  canManage: boolean;
  onStageChange: (newStageId: string, newStatus: string) => void;
}

export function StageStepper({
  stages,
  currentStageId,
  applicationId,
  canManage,
  onStageChange,
}: StageStepperProps) {
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
    <div className="space-y-1">
      {stages.map((stage, index) => {
        const isPast = stage.position < currentPosition;
        const isCurrent = stage.id === currentStageId;
        const isLoading = advancingTo === stage.id;
        const isClickable = canManage && !isCurrent && !advancingTo;
        const isTerminalWon = stage.terminal_type === "won";
        const isTerminalLost = stage.terminal_type === "lost";

        return (
          <div key={stage.id} className="flex items-start gap-3">
            {/* Connector line + dot column */}
            <div className="flex flex-col items-center">
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
                title={isClickable ? `Move to ${stage.name}` : stage.name}
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
              {index < stages.length - 1 && (
                <div
                  className="w-0.5 h-4 mt-0.5"
                  style={{
                    backgroundColor: isPast ? `${stage.color}60` : "hsl(var(--border))",
                  }}
                />
              )}
            </div>

            {/* Stage label */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => handleStageClick(stage)}
              className={[
                "flex-1 text-left pt-0.5 pb-3 leading-snug transition-colors",
                isCurrent ? "font-semibold text-foreground" : "",
                isPast ? "text-muted-foreground text-sm" : "text-sm text-muted-foreground",
                isClickable ? "cursor-pointer hover:text-foreground" : "cursor-default",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="flex items-center gap-1.5">
                {stage.name}
                {isTerminalWon && (
                  <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                    Enrolled
                  </span>
                )}
                {isTerminalLost && (
                  <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">
                    Ended
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
