"use client";

import { Sparkles } from "lucide-react";

/** Shown when the assistant flag is off — the same 404 shape as a missing conversation makes any other distinction unreliable, so we just say it plainly. */
export function AssistantDisabled() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
      <Sparkles className="h-6 w-6 text-gray-300" />
      <p className="text-sm text-gray-400">The AI assistant isn&apos;t enabled for this workspace yet.</p>
    </div>
  );
}
