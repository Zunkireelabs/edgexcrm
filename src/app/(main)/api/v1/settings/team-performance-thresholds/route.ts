import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createRequestLogger } from "@/lib/logger";
import { resolveThresholds } from "@/industries/education-consultancy/features/team-performance/lib/thresholds";
import type { TenantConfig } from "@/types/database";

// GET/PATCH /api/v1/settings/team-performance-thresholds — the Settings UI surface
// for the three Team & Lead Performance tunables that were hand-editable-JSON-only
// in Phase 1 (thresholds.ts): follow_up_stale_days, callback_reminder_minutes,
// intake_alarm_buckets_hours. Stored on tenants.config.team_performance_thresholds —
// same JSONB column every threshold in this feature already uses, no new table.
// Owner/admin, education_consultancy only (mirrors intake-alarm/route.ts's gate).

async function guard() {
  const auth = await authenticateRequest();
  if (!auth) return { ok: false as const, response: apiUnauthorized() };
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return { ok: false as const, response: apiForbidden() };
  if (!getFeatureAccess(auth.industryId, FEATURES.TEAM_PERFORMANCE)) return { ok: false as const, response: apiForbidden() };
  if (!requireAdmin(auth)) return { ok: false as const, response: apiForbidden() };
  return { ok: true as const, auth };
}

export async function GET() {
  const guarded = await guard();
  if (!guarded.ok) return guarded.response;
  const { auth } = guarded;

  const db = await scopedClient(auth);
  const { data: tenantRow } = await db.raw().from("tenants").select("config").eq("id", auth.tenantId).single();
  const thresholds = resolveThresholds((tenantRow?.config ?? null) as TenantConfig | null);

  return apiSuccess(thresholds);
}

export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/settings/team-performance-thresholds" });

  const guarded = await guard();
  if (!guarded.ok) return guarded.response;
  const { auth } = guarded;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return apiValidationError({ body: ["Request body must be a JSON object"] });
  const b = body as Record<string, unknown>;

  const errors: Record<string, string[]> = {};

  const followUpStaleDays = b.follow_up_stale_days;
  if (followUpStaleDays !== undefined && (!Number.isInteger(followUpStaleDays) || (followUpStaleDays as number) < 1)) {
    errors.follow_up_stale_days = ["Must be an integer of at least 1"];
  }

  const callbackReminderMinutes = b.callback_reminder_minutes;
  if (
    callbackReminderMinutes !== undefined &&
    (!Number.isInteger(callbackReminderMinutes) || (callbackReminderMinutes as number) < 1)
  ) {
    errors.callback_reminder_minutes = ["Must be an integer of at least 1"];
  }

  const buckets = b.intake_alarm_buckets_hours;
  if (buckets !== undefined) {
    const valid =
      Array.isArray(buckets) &&
      buckets.length === 2 &&
      buckets.every((n) => Number.isInteger(n) && n >= 1) &&
      (buckets[0] as number) < (buckets[1] as number);
    if (!valid) {
      errors.intake_alarm_buckets_hours = ["Must be two ascending integers (hours), each at least 1"];
    }
  }

  if (Object.keys(errors).length > 0) return apiValidationError(errors);
  if (followUpStaleDays === undefined && callbackReminderMinutes === undefined && buckets === undefined) {
    return apiValidationError({ body: ["No editable fields provided"] });
  }

  const db = await scopedClient(auth);

  // Read-modify-write: tenants.config carries several unrelated keys (statuses,
  // max_file_size_mb, accepted_file_types, …) — only merge this feature's own
  // sub-object in, never overwrite the whole column.
  const { data: tenantRow } = await db.raw().from("tenants").select("config").eq("id", auth.tenantId).single();
  const config = ((tenantRow?.config ?? {}) as TenantConfig) || {};
  const nextThresholds = { ...(config.team_performance_thresholds ?? {}) };
  if (followUpStaleDays !== undefined) nextThresholds.follow_up_stale_days = followUpStaleDays as number;
  if (callbackReminderMinutes !== undefined) nextThresholds.callback_reminder_minutes = callbackReminderMinutes as number;
  if (buckets !== undefined) nextThresholds.intake_alarm_buckets_hours = buckets as [number, number];

  const nextConfig: TenantConfig = { ...config, team_performance_thresholds: nextThresholds };

  const { error } = await db.raw().from("tenants").update({ config: nextConfig }).eq("id", auth.tenantId);

  if (error) {
    log.error({ err: error }, "Failed to update team performance thresholds");
    return apiServiceUnavailable("Failed to update team performance thresholds");
  }

  log.info({ tenantId: auth.tenantId, nextThresholds }, "Team performance thresholds updated");
  return apiSuccess(resolveThresholds(nextConfig));
}
