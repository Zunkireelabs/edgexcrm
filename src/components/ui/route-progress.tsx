"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { shouldStartForClick } from "@/lib/route-progress";
import { routeChanged, start } from "@/lib/route-progress-store";

/**
 * Global half of the route-loading indicator. It renders nothing itself: it only STARTS a
 * navigation (plain click on an internal link, or back/forward) and tells the store when the URL
 * changes. The visible "Loading… NN%" lives inside each page's own `loading.tsx` (see
 * `LoadingPercent`), so it sits in the destination page's layout instead of over content; it
 * finishes when that loading screen is replaced by the real page. Programmatic router.push/replace
 * need no wiring: any loading screen appearing starts the indicator on its own.
 *
 * Add `data-no-progress` to a link to opt it out.
 */
function RouteProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const begin = () => start({ reducedMotion: reducedMotion.current });

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
      if (shouldStart) begin();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", begin);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", begin);
    };
  }, []);

  // The URL changed: tell the store (it decides whether the loading screen or the route is "done").
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    routeChanged();
  }, [routeKey]);

  return null;
}

/** Mount once in the dashboard layout. `useSearchParams` needs a Suspense boundary. */
export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <RouteProgressInner />
    </Suspense>
  );
}
