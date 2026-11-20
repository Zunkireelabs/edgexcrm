import type { AuthContext } from "@/lib/api/auth";
import type { TenantConfig } from "@/types/database";
import { resolvePulseThresholds } from "../../pulse/lib/thresholds";
import { periodSpans, resolvePulseWindow, windowLengthMs } from "../../pulse/lib/window";
import type { PulseContext } from "../../pulse/server/context";
import type { HomeDb } from "./load-home";

/**
 * A PulseContext for Home's own reads: the 7-day window in the tenant timezone. Pulse's HTTP routes are owner/admin-only
 * (`resolvePulseContext`), so Home builds the same struct itself and calls Pulse's own loaders with it. That is how
 * Home and Pulse share one set of inputs and maths instead of forking them.
 */
export function buildHomePulseContext(
  auth: AuthContext,
  db: HomeDb,
  tz: string,
  config: TenantConfig | null | undefined,
  now: Date,
  branchId: string | null,
  branches: Array<{ id: string; name: string }>,
  tenantName = "",
): PulseContext | null {
  const window = resolvePulseWindow("7d", now, tz);
  if (!window) return null;
  const prev = periodSpans(window, tz).previous;
  return {
    auth,
    db,
    tz,
    window,
    windowInfo: {
      key: window.key,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      tz,
      previousFrom: prev.from.toISOString(),
      previousTo: prev.to.toISOString(),
      days: windowLengthMs(window) / 86_400_000,
    },
    branchId,
    branches,
    thresholds: resolvePulseThresholds(config),
    tenantName,
    aiMode: "off",
  };
}
