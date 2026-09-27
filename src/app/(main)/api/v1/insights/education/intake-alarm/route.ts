import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveThresholds } from "@/industries/education-consultancy/features/team-performance/lib/thresholds";
import type { TenantConfig } from "@/types/database";

// Powers the Intake Alarm widget: (a) Pre-qualified leads with no qualifying
// touch yet, bucketed by configurable age thresholds (education_intake_alarm,
// migration 242); (b) staff who touched zero leads anywhere in the last 24h
// (education_idle_staff, same migration) — an idle/absent-staffer flag, not a
// "this lead is stuck" flag. Window-independent for (a) (age is since lead
// creation); (b) uses a fixed trailing 24h window, not the dashboard's date
// picker, since "staff who did nothing today" is the useful question regardless
// of which historical window the rest of the dashboard is showing.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (!getFeatureAccess(auth.industryId, FEATURES.TEAM_PERFORMANCE)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);

  const { data: tenantRow } = await db.raw().from("tenants").select("config").eq("id", auth.tenantId).single();
  const thresholds = resolveThresholds((tenantRow?.config ?? null) as TenantConfig | null);

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [alarmResult, idleResult] = await Promise.all([
    db.raw().rpc("education_intake_alarm", {
      p_tenant: auth.tenantId,
      p_now: now.toISOString(),
      p_bucket1_hours: thresholds.intakeAlarmBucketsHours[0],
      p_bucket2_hours: thresholds.intakeAlarmBucketsHours[1],
    }),
    db.raw().rpc("education_idle_staff", {
      p_tenant: auth.tenantId,
      p_from: dayAgo.toISOString(),
      p_to: now.toISOString(),
    }),
  ]);

  if (alarmResult.error || idleResult.error) return apiError("DB_ERROR", "Failed to load intake alarm", 500);

  return apiSuccess({
    buckets: alarmResult.data ?? [],
    idleStaff: idleResult.data ?? [],
  });
}
