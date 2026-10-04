import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { DEFAULT_SEND_WINDOW, isValidTimeZone } from "@/industries/_shared/features/outreach/lib/send-window";

// GET /api/v1/outreach/send-window-defaults — what the sequence editor pre-fills for a NEW sequence's send window:
// the office's timezone (tenants.timezone) and a default window whose allowed days are the tenant's working days —
// every weekday except tenants.weekend_days (0 = Sunday … 6 = Saturday; Nepal's default is Saturday only).
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data } = await db.fromGlobal("tenants").select("timezone, weekend_days").eq("id", auth.tenantId).maybeSingle();
  const row = data as { timezone?: string | null; weekend_days?: number[] | null } | null;

  const timezone = row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : "UTC";
  const weekend = Array.isArray(row?.weekend_days) ? row!.weekend_days! : [6];
  const workingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d));

  return apiSuccess({
    timezone,
    weekend_days: weekend,
    window: { ...DEFAULT_SEND_WINDOW, days: workingDays.length > 0 ? workingDays : DEFAULT_SEND_WINDOW.days },
  });
}
