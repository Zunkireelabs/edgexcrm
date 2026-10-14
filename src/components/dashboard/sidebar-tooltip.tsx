"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarTipProps {
  label: string;
  /** Pass the collapsed flag — when false the children render untouched (no tooltip, no extra cost). */
  enabled?: boolean;
  children: ReactNode;
}

/**
 * Instant label tooltip for icon-only sidebar items. Needs a `TooltipProvider` above it (the sidebar mounts one with
 * `delayDuration={0}`), so the label shows on the first hover frame and moving between icons never re-waits. The
 * enter/exit animation is switched off (`!animate-none`) so there is no fade-in lag at all — it is simply there.
 * Replaces the native `title=` attribute, which lags ~0.5–1.5 s and doesn't show on keyboard focus.
 */
export function SidebarTip({ label, enabled = true, children }: SidebarTipProps) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="!animate-none">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
