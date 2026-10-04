"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getServerSnapshot,
  getSnapshot,
  skeletonMounted,
  skeletonUnmounted,
  subscribe,
} from "@/lib/route-progress-store";

/**
 * The "Loading… NN%" chip. Render it inside a page's `loading.tsx` (via `LoadingTitle`), in the spot
 * where the page's real title will appear, so the percentage lives in the destination page's own
 * layout instead of floating over content. While it is mounted the navigation counts as in flight;
 * when the real page replaces the loading screen it unmounts, which completes the top bar.
 */
export function LoadingPercent({ className }: { className?: string }) {
  const { progress } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    skeletonMounted();
    return skeletonUnmounted;
  }, []);

  const rounded = Math.round(progress);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`Loading ${rounded}%`}
      // Fades in after ~200ms so a near-instant page doesn't flash a number.
      style={{ animationDelay: "200ms" }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-xs",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-safe:fill-mode-backwards",
        className,
      )}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      <span>Loading…</span>
      <span className="min-w-[2.5ch] text-right tabular-nums text-foreground">{rounded}%</span>
    </span>
  );
}

/**
 * The title row of a page's loading screen: the page's real title (when `label` is given — it is
 * already known, so there is nothing to shimmer) with the loading chip beside it. Without a label
 * (e.g. Home's personalised greeting, or the generic fallback) it keeps a grey title block.
 * Height is fixed at h-7 to match the grey block it replaces, so nothing shifts.
 */
export function LoadingTitle({
  label,
  headingClassName = "text-base font-bold",
  skeletonClassName = "w-48",
  className,
}: {
  label?: string;
  headingClassName?: string;
  skeletonClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex h-7 items-center gap-3", className)}>
      {label ? (
        <h1 className={cn("leading-7", headingClassName)}>{label}</h1>
      ) : (
        <Skeleton className={cn("h-7", skeletonClassName)} />
      )}
      <LoadingPercent />
    </div>
  );
}
