import { PROGRESS_CAP, nextProgress } from "@/lib/route-progress";

/**
 * Shared state for the route-loading indicator. One module-level store:
 *   - the navigation tracker (`RouteProgress`) STARTS it on a link click / back-forward and reports
 *     URL changes;
 *   - the in-page "Loading… NN%" chip (`LoadingPercent`), rendered inside each page's `loading.tsx`,
 *     reads it through `useSyncExternalStore` and is the only visible indicator.
 *
 * "Done" means the destination's loading screen has been replaced by the real page. Detected by the
 * chip unmounting (every `loading.tsx` renders one). If a route renders without ever showing a
 * loading screen (cached/instant), the route change itself finishes it. The percentage is simulated:
 * it trickles to PROGRESS_CAP and holds, and only a real completion takes it to 100.
 */

export type RouteProgressStatus = "idle" | "loading" | "done";
export interface RouteProgressState {
  status: RouteProgressStatus;
  progress: number;
}

const TICK_MS = 100;
/** Let a finished bar linger at 100% before hiding. */
const DONE_LINGER_MS = 250;
/** After the last loading screen unmounts, wait this long before finishing — an outer→inner
 *  `loading.tsx` handoff briefly unmounts one chip and mounts the next in the same commit. */
const HANDOFF_GRACE_MS = 120;
/** A route that changed without ever showing a loading screen is done after this grace. */
const NO_SKELETON_GRACE_MS = 100;
/** Give up on a navigation whose URL/loading screen never appears. */
const GIVE_UP_NO_SKELETON_MS = 10_000;
/** Hard cap even with a loading screen on screen, so it can never stick forever. */
const GIVE_UP_HARD_MS = 60_000;

const IDLE: RouteProgressState = { status: "idle", progress: 0 };

let state: RouteProgressState = IDLE;
const listeners = new Set<() => void>();

let tickTimer: ReturnType<typeof setInterval> | null = null;
let handoffTimer: ReturnType<typeof setTimeout> | null = null;
let noSkeletonTimer: ReturnType<typeof setTimeout> | null = null;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = 0;
let sawSkeleton = false;
let reduced = false;

function set(next: RouteProgressState) {
  if (next.status === state.status && next.progress === state.progress) return;
  state = next;
  listeners.forEach((l) => l());
}

function clear(t: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null) {
  if (t) {
    clearTimeout(t as ReturnType<typeof setTimeout>);
    clearInterval(t as ReturnType<typeof setInterval>);
  }
}

function clearAllTimers() {
  clear(tickTimer);
  clear(handoffTimer);
  clear(noSkeletonTimer);
  clear(lingerTimer);
  clear(giveUpTimer);
  tickTimer = handoffTimer = noSkeletonTimer = lingerTimer = giveUpTimer = null;
}

function scheduleGiveUp() {
  clear(giveUpTimer);
  giveUpTimer = setTimeout(() => {
    if (sawSkeleton && mounted > 0) {
      // A loading screen is still up — keep waiting, but not forever.
      giveUpTimer = setTimeout(reset, GIVE_UP_HARD_MS - GIVE_UP_NO_SKELETON_MS);
    } else {
      reset();
    }
  }, GIVE_UP_NO_SKELETON_MS);
}

/** Begin a navigation. Idempotent while one is already in flight (the % carries on, never jumps back). */
export function start(options: { reducedMotion?: boolean } = {}) {
  reduced = options.reducedMotion ?? reduced;
  if (state.status === "loading") return;
  clearAllTimers();
  sawSkeleton = mounted > 0;
  set({ status: "loading", progress: reduced ? PROGRESS_CAP : 0 });
  if (!reduced) {
    tickTimer = setInterval(() => set({ status: "loading", progress: nextProgress(state.progress) }), TICK_MS);
  }
  scheduleGiveUp();
}

/** Complete: jump to 100%, linger briefly, then go idle. */
export function finish() {
  if (state.status !== "loading") return;
  clear(tickTimer);
  clear(handoffTimer);
  clear(noSkeletonTimer);
  clear(giveUpTimer);
  tickTimer = handoffTimer = noSkeletonTimer = giveUpTimer = null;
  set({ status: "done", progress: 100 });
  lingerTimer = setTimeout(reset, DONE_LINGER_MS);
}

/** Back to idle (also used by the give-up timer and by tests). */
export function reset() {
  clearAllTimers();
  mounted = 0;
  sawSkeleton = false;
  set(IDLE);
}

/** A page's loading screen mounted. If nothing started the navigation (e.g. a programmatic
 *  router.push, or a direct load), seeing a loading screen is itself the start. */
export function skeletonMounted() {
  mounted += 1;
  sawSkeleton = true;
  clear(handoffTimer);
  handoffTimer = null;
  clear(noSkeletonTimer);
  noSkeletonTimer = null;
  if (state.status === "idle" || state.status === "done") {
    clear(lingerTimer);
    lingerTimer = null;
    state = IDLE;
    start();
  }
}

/** A page's loading screen unmounted — the real page has replaced it (or the user navigated away). */
export function skeletonUnmounted() {
  mounted = Math.max(0, mounted - 1);
  if (mounted === 0 && state.status === "loading") {
    clear(handoffTimer);
    handoffTimer = setTimeout(finish, HANDOFF_GRACE_MS);
  }
}

/** The URL changed. With a loading screen up, the chip unmounting decides "done"; if the route
 *  rendered without ever showing one, finish shortly after the change. */
export function routeChanged() {
  if (state.status !== "loading" || sawSkeleton) return;
  clear(noSkeletonTimer);
  noSkeletonTimer = setTimeout(() => {
    if (!sawSkeleton) finish();
  }, NO_SKELETON_GRACE_MS);
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSnapshot(): RouteProgressState {
  return state;
}
export function getServerSnapshot(): RouteProgressState {
  return IDLE;
}
