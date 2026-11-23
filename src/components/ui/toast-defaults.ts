import { toast } from "sonner";

/**
 * EDGEX-143 Toasts v1: per-type default durations, applied centrally so none of the ~980 call sites change.
 *
 * sonner has no per-type duration prop, so the Toaster mounts this once (client side) and the typed helpers
 * are wrapped to inject a default `duration` only when the call site did not pass one:
 *   - error / warning  -> Infinity (stay until closed; the close button is always shown)
 *   - success / info / message with an `action` (e.g. Undo) -> 5000 ms
 *   - success / info / message -> 3000 ms
 * An explicit `duration` at the call site always wins. Hover pause stays sonner's default.
 * A bare `toast("x")` call cannot be wrapped; it takes the Toaster-wide 3000 ms default.
 */
export const TOAST_DURATION_MS = 3000;
export const TOAST_ACTION_DURATION_MS = 5000;

type Kind = "success" | "info" | "message" | "error" | "warning";
type Data = { duration?: number; action?: unknown } & Record<string, unknown>;

export function defaultDuration(kind: Kind, data?: Data): number {
  if (data && typeof data.duration === "number") return data.duration;
  if (kind === "error" || kind === "warning") return Infinity;
  return data?.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS;
}

const APPLIED = Symbol.for("edgex.toast-defaults");

export function applyToastDefaults(target: Record<string | symbol, unknown> = toast as unknown as Record<string | symbol, unknown>): void {
  if (target[APPLIED]) return;
  target[APPLIED] = true;
  for (const kind of ["success", "info", "message", "error", "warning"] as const) {
    const original = target[kind] as ((msg: unknown, data?: Data) => unknown) | undefined;
    if (typeof original !== "function") continue;
    target[kind] = (msg: unknown, data?: Data) => original.call(target, msg, { ...data, duration: defaultDuration(kind, data) });
  }
}
