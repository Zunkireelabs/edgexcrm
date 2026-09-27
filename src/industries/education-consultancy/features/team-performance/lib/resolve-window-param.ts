import { resolveDateWindow, type DateWindow } from "@/industries/_shared/features/insights/lib/date-window";

// Fallback only when the tenant row itself can't be read — tenants.timezone is
// NOT NULL DEFAULT 'Asia/Kathmandu' (migration 116), so this should be dead code
// in practice. The real timezone always comes from the caller's tenant row.

/** Shared by every window-scoped team-performance route (relay/leakage). */
export function resolveWindowParam(searchParams: URLSearchParams, tenantTimezone: string | null): DateWindow | null {
  const key = searchParams.get("window") ?? "today";
  const tz = searchParams.get("tz") ?? tenantTimezone ?? "Asia/Kathmandu";
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  return resolveDateWindow(key, new Date(), tz, from && to ? { from, to } : undefined);
}
