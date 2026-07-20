import { Sparkles } from "lucide-react";

/** Shared visual marker for every AI-synth vision-preview surface (see
 * lib/ai-preview.ts). Keep this the ONE pill style so "Preview" always reads
 * consistently across surfaces. */
export function PreviewPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
      <Sparkles className="h-3 w-3" />
      Preview
    </span>
  );
}
