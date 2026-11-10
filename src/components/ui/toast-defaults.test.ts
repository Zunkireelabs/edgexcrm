import { describe, it, expect, vi } from "vitest";

vi.mock("sonner", () => ({ toast: {} }));

import { applyToastDefaults, defaultDuration } from "./toast-defaults";

function fakeToast() {
  const t: Record<string | symbol, unknown> = {};
  for (const k of ["success", "info", "message", "error", "warning", "loading"]) t[k] = vi.fn();
  return t;
}

describe("toast defaults (EDGEX-143)", () => {
  it("success/info/message 3000, with action 5000, error/warning persistent, explicit duration wins", () => {
    expect(defaultDuration("success")).toBe(3000);
    expect(defaultDuration("info")).toBe(3000);
    expect(defaultDuration("message")).toBe(3000);
    expect(defaultDuration("success", { action: { label: "Undo" } })).toBe(5000);
    expect(defaultDuration("error")).toBe(Infinity);
    expect(defaultDuration("warning", { action: {} })).toBe(Infinity);
    expect(defaultDuration("error", { duration: 8000 })).toBe(8000);
    expect(defaultDuration("success", { duration: 1000 })).toBe(1000);
  });

  it("wraps the typed helpers, keeps other fields, leaves loading alone, and is idempotent", () => {
    const t = fakeToast();
    const origSuccess = t.success as ReturnType<typeof vi.fn>;
    const origLoading = t.loading;
    applyToastDefaults(t);
    applyToastDefaults(t);
    (t.success as (m: string, d?: object) => void)("Saved", { description: "x" });
    expect(origSuccess).toHaveBeenCalledTimes(1);
    expect(origSuccess).toHaveBeenCalledWith("Saved", { description: "x", duration: 3000 });
    (t.error as (m: string) => void)("Boom");
    expect(t.loading).toBe(origLoading);
  });
});
