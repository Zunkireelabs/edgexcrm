"use client";

import { useEffect, useSyncExternalStore } from "react";
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
 * The loading percentage — just the number ("66%"), nothing else. Render it inside a page's
 * `loading.tsx` (via `LoadingTitle`), in the spot where the page's real title will appear, so it
 * lives in the destination page's own layout instead of floating over content. While it is mounted
 * the navigation counts as in flight; when the real page replaces the loading screen it unmounts,
 * which completes the navigation.
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
        "min-w-[3ch] text-sm font-medium tabular-nums text-muted-foreground",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-safe:fill-mode-backwards",
        className,
      )}
    >
      {rounded}%
    </span>
  );
}

/**
 * The title row of a page's loading screen: the page's real title (when `label` is given — it is
 * already known, so there is nothing to shimmer) with the loading percentage beside it. Without a label
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
