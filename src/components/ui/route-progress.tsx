"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PROGRESS_CAP, nextProgress, shouldStartForClick } from "@/lib/route-progress";

/** Wait this long before showing the badge, so instant navigations only flash the thin bar. */
const BADGE_DELAY_MS = 200;
/** Trickle cadence of the simulated percentage. */
const TICK_MS = 100;
/** How long the finished 100% bar lingers before fading out. */
const DONE_LINGER_MS = 250;
/** If the URL never changes (aborted nav, link handled by custom onClick), give up rather than stick. */
const GIVE_UP_MS = 10_000;

type Status = "idle" | "loading" | "done";

/**
 * Route-loading indicator: a thin top bar plus a "Loading… NN%" badge while an in-app navigation
 * is in flight. The percentage is simulated (it trickles to 90% and holds); it reaches 100% only
 * once `usePathname()`/`useSearchParams()` actually change, i.e. the new route has rendered.
 *
 * Starts on a plain click on an internal link, or back/forward. Programmatic router.push/replace
 * (e.g. filter changes) are deliberately not instrumented. Add `data-no-progress` to a link to opt out.
 */
function RouteProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [showBadge, setShowBadge] = useState(false);

  const reducedMotion = useRef(false);

  // The route changed: the new page has rendered, so a navigation that was in flight completes.
  // Detected during render (React's "adjust state on prop change" pattern) rather than in an
  // effect; a done/idle indicator is left as it is. The initial value is the current route, so
  // nothing fires on first render.
  const routeKey = `${pathname}?${search}`;
  const [prevRouteKey, setPrevRouteKey] = useState(routeKey);
  if (routeKey !== prevRouteKey) {
    setPrevRouteKey(routeKey);
    if (status === "loading") setStatus("done");
  }

  const start = useCallback(() => {
    setProgress(reducedMotion.current ? PROGRESS_CAP : 0);
    setShowBadge(false);
    setStatus("loading");
  }, []);

  // Detect the start of a navigation.
  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onClick = (e: MouseEvent) => {
      const anchorEl = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const shouldStart = shouldStartForClick(
        {
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          anchor: anchorEl
            ? {
                href: anchorEl.getAttribute("href") ?? "",
                target: anchorEl.getAttribute("target"),
                hasDownload: anchorEl.hasAttribute("download"),
                optOut: anchorEl.hasAttribute("data-no-progress"),
              }
            : null,
        },
        window.location.href,
      );
      if (shouldStart) start();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
    };
  }, [start]);

  // Simulated trickle + the delayed badge + the give-up safety net, only while loading.
  useEffect(() => {
    if (status !== "loading") return;
    const tick = reducedMotion.current
      ? null
      : setInterval(() => setProgress((p) => nextProgress(p)), TICK_MS);
    const badge = setTimeout(() => setShowBadge(true), BADGE_DELAY_MS);
    const giveUp = setTimeout(() => {
      setStatus("idle");
      setProgress(0);
      setShowBadge(false);
    }, GIVE_UP_MS);
    return () => {
      if (tick) clearInterval(tick);
      clearTimeout(badge);
      clearTimeout(giveUp);
    };
  }, [status]);

  // Let the finished bar linger briefly, then hide.
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(() => {
      setStatus("idle");
      setProgress(0);
      setShowBadge(false);
    }, DONE_LINGER_MS);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "idle") return null;

  // "done" always reads 100%, whatever the trickle had reached.
  const shown = status === "done" ? 100 : progress;
  const rounded = Math.round(shown);
  return (
    <>
      <div
        role="progressbar"
        aria-label="Page loading"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 bg-transparent"
      >
        <div
          className="h-full bg-primary motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out"
          style={{ width: `${shown}%` }}
        />
      </div>
      {showBadge && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-24 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground shadow-md"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
          <span>Loading…</span>
          <span className="min-w-[2.5ch] text-right tabular-nums text-muted-foreground">{rounded}%</span>
        </div>
      )}
    </>
  );
}

/** Mount once in the dashboard layout. `useSearchParams` needs a Suspense boundary. */
export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <RouteProgressInner />
    </Suspense>
  );
}
