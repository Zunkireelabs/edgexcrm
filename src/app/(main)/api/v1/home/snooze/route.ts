import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiForbidden, apiSuccess, apiUnauthorized, apiValidationError, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isValidItemKey, snoozeUntilTomorrow } from "@/industries/education-consultancy/features/home/lib/snooze";

// POST /api/v1/home/snooze  { item_key }  → hides that Home item for the caller until the next morning (tenant time).
// Per user, per item; written by the server only (home_item_snoozes has no client write policy).
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  if (!isValidItemKey(body.item_key)) return apiValidationError({ item_key: ["Invalid item key"] });

  const db = await scopedClient(auth);
  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const tz = (tenantRow as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const until = snoozeUntilTomorrow(new Date(), tz);

  const { error } = await db
    .from("home_item_snoozes")
    .upsert({ user_id: auth.userId, item_key: body.item_key, until: until.toISOString() }, { onConflict: "tenant_id,user_id,item_key" });
  if (error) return apiError("DB_ERROR", "Failed to snooze", 500);
  return apiSuccess({ item_key: body.item_key, until: until.toISOString() });
}
