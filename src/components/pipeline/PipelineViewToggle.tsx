"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface PipelineViewToggleProps {
  activeView: "funnel" | "pipeline";
}

export function PipelineViewToggle({ activeView }: PipelineViewToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSwitch(view: "funnel" | "pipeline") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.push(`/pipeline?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/50 p-0.5">
      <button
        type="button"
        onClick={() => handleSwitch("funnel")}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          activeView === "funnel"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Funnel Board
      </button>
      <button
        type="button"
        onClick={() => handleSwitch("pipeline")}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          activeView === "pipeline"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Pipeline Board
      </button>
    </div>
  );
}