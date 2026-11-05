import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { TenantConfig } from "@/types/database";
import { resolvePulseThresholds, type PulseThresholds } from "../lib/thresholds";
import { previousWindow, resolvePulseWindow, windowLengthMs, type PulseWindow } from "../lib/window";
import type { PulseWindowInfo } from "../lib/types";

export type PulseDb = Awaited<ReturnType<typeof scopedClient>>;

export interface PulseContext {
  auth: AuthContext;
  db: PulseDb;
  tz: string;
  window: PulseWindow;
  windowInfo: PulseWindowInfo;
  branchId: string | null;
  branches: Array<{ id: string; name: string }>;
  thresholds: PulseThresholds;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

/**
 * Every Pulse route starts here: authenticate -> industry gate -> owner/admin gate -> tenant timezone/config ->
 * window + branch parsing. Returns either a context or the Response to send.
 */
export async function resolvePulseContext(
  request: NextRequest,
): Promise<{ ok: true; ctx: PulseContext } | { ok: false; response: Response }> {
  const auth = await authenticateRequest();
  if (!auth) return { ok: false, response: apiUnauthorized() };
  if (!getFeatureAccess(auth.industryId, FEATURES.PULSE)) return { ok: false, response: apiForbidden() };
  if (auth.role !== "owner" && auth.role !== "admin") return { ok: false, response: apiForbidden() };

  const db = await scopedClient(auth);
  const { data: tenantRow } = await db.raw().from("tenants").select("timezone, config").eq("id", auth.tenantId).single();
  const tenant = tenantRow as unknown as { timezone: string | null; config: TenantConfig | null } | null;
  const tz = tenant?.timezone ?? "Asia/Kathmandu";

  const sp = request.nextUrl.searchParams;
  const window = resolvePulseWindow(sp.get("window") ?? "7d", new Date(), tz, { from: sp.get("from"), to: sp.get("to") });
  if (!window) return { ok: false, response: apiError("VALIDATION_ERROR", "Invalid or missing date window", 422) };

  const { data: branchRows } = await db.from("branches").select("id, name").order("sort_order", { ascending: true });
  const branches = ((branchRows ?? []) as unknown as Array<{ id: string; name: string }>).map((b) => ({ id: b.id, name: b.name }));

  // Branch: explicit ?branch= wins, otherwise the top-bar switcher's cookie. "all"/empty/stale = Overall.
  let branchParam = sp.get("branch");
  if (branchParam === null) {
    try {
      branchParam = (await cookies()).get("edgex_branch")?.value ?? null;
    } catch {
      branchParam = null;
    }
  }
  const branchId = isUuid(branchParam) && branches.some((b) => b.id === branchParam) ? branchParam : null;

  const prev = previousWindow(window);
  return {
    ok: true,
    ctx: {
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
      thresholds: resolvePulseThresholds(tenant?.config),
    },
  };
}

/** auth.users names (service-only API -> raw()), keyed by id. */
export async function loadUserNames(db: PulseDb): Promise<Map<string, { name: string; email: string | null }>> {
  const { data } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const out = new Map<string, { name: string; email: string | null }>();
  for (const u of data?.users ?? []) {
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    const name = (meta?.name ?? meta?.full_name ?? null) as string | null;
    out.set(u.id, { name: name || u.email || "Unknown", email: u.email ?? null });
  }
  return out;
}
