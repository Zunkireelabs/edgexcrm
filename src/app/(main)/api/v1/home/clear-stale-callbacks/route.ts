import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getBranches } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveHomeScope } from "@/industries/education-consultancy/features/home/lib/scope";
import { clearCountMatches } from "@/industries/education-consultancy/features/home/lib/stale-callbacks";
import { makeLeadScope } from "@/industries/education-consultancy/features/home/server/lead-scope";
import { clearStaleCallbacks, countStaleCallbacks } from "@/industries/education-consultancy/features/home/server/stale-callbacks";

// POST /api/v1/home/clear-stale-callbacks  { expected_count }
// Owner / admin / team-scope manager only (anyone who sees more than their own leads), for THEIR scope (the leads list's own
// branch definitions: see server/lead-scope.ts). Clears call-back
// reminders older than 14 tenant-local days through the audited lead-patch path. The server recomputes the set; the client
// only confirms the number it showed (a >10% difference returns 409 with the new count so the person re-confirms).
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
  const expected = body.expected_count;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) {
    return apiValidationError({ expected_count: ["The count you confirmed is required"] });
  }

  const [branches, cookieStore] = await Promise.all([getBranches(auth.tenantId), cookies()]);
  const scope = resolveHomeScope(auth.permissions, auth.userId, auth.branchId, cookieStore.get("edgex_branch")?.value ?? null, branches.map((b) => b.id));
  if (scope.mode !== "manager") return apiForbidden();

  const db = await scopedClient(auth);
  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const tz = (tenantRow as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const now = new Date();

  const leads = await makeLeadScope(db, auth, scope);
  const actual = await countStaleCallbacks(leads, now, tz);
  if (!clearCountMatches(expected, actual)) {
    return apiError("COUNT_CHANGED", "The number of reminders changed", 409, { count: actual });
  }
  return apiSuccess(await clearStaleCallbacks(leads, auth, now, tz));
}
