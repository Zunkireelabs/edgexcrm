"use client";

import { cn } from "@/lib/utils";
import type { ViewMode } from "./types";

interface ModeToggleProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="inline-flex items-center bg-gray-100 rounded-full p-1">
      <button
        onClick={() => onModeChange("people")}
        className={cn(
          "px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200",
          mode === "people"
            ? "bg-[#eb1600] text-white shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        )}
      >
        People
      </button>
      <button
        onClick={() => onModeChange("agents")}
        className={cn(
          "px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200",
          mode === "agents"
            ? "bg-[#4a9d7c] text-white shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        )}
      >
        With agents
      </button>
    </div>
  );
}
