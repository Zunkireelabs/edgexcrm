import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { homeAiEnabled } from "@/industries/education-consultancy/features/home/ai/gate";
import { READ_MAX_REFRESHES } from "@/industries/education-consultancy/features/home/lib/orca-read";
import { localDate } from "@/industries/education-consultancy/features/home/lib/time";
import { buildReadFacts, makeRead, resolveReadScope } from "@/industries/education-consultancy/features/home/server/orca-read";
import { loadStoredRead } from "@/industries/education-consultancy/features/home/server/stored-read";
import type { TenantConfig } from "@/types/database";

// POST /api/v1/home/read  { action?: "open" | "refresh" | "feedback", value?: 1 | -1 }
//   open     (default) the card mounted: today's read exists -> mark Home opened and return it; else make it now (first open of the day).
//   refresh  remake it, at most 3 times a day.
//   feedback thumbs up / down on today's read.
// The facts are rebuilt on the server from the caller's own Home loaders: nothing the client sends reaches the prompt.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* an empty body is "open" */
  }
  const action = body.action === "refresh" || body.action === "feedback" ? body.action : "open";

  if (!(await homeAiEnabled(auth.tenantId))) return apiSuccess({ ai: false });
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) return apiUnauthorized();
  const tenant = tenantData.tenant;
  const tz = tenant.timezone ?? "Asia/Kathmandu";
  const now = new Date();
  const forDate = localDate(now, tz);
  const db = await scopedClient(auth);

  const cookieBranch = (await cookies()).get("edgex_branch")?.value ?? null;
  const { scope, home } = await resolveReadScope(auth, tenant.id, cookieBranch);
  const existing = await loadStoredRead(db, auth.userId, scope, forDate);

  if (action === "feedback") {
    if (body.value !== 1 && body.value !== -1) return apiValidationError({ value: ["Must be 1 or -1"] });
    if (!existing) return apiValidationError({ read: ["No read to rate"] });
    const { error } = await db.from("home_reads").update({ feedback: body.value, feedback_at: now.toISOString() }).eq("user_id", auth.userId).eq("scope", scope).eq("for_date", forDate);
    if (error) return apiError("DB_ERROR", "Failed to save", 500);
    return apiSuccess({ ai: true, read: { ...existing, feedback: body.value } });
  }

  if (action === "open" && existing) {
    await db.from("home_reads").update({ opened_at: now.toISOString() }).eq("user_id", auth.userId).eq("scope", scope).eq("for_date", forDate);
    return apiSuccess({ ai: true, read: existing });
  }
  if (action === "refresh") {
    if (!existing) return apiValidationError({ read: ["Nothing to refresh yet"] });
    if (existing.refreshes >= READ_MAX_REFRESHES) return apiError("REFRESH_LIMIT", "Orca's read can be remade 3 times a day.", 429);
  }

  const facts = await buildReadFacts(auth, { name: tenant.name ?? null, timezone: tenant.timezone ?? null, config: (tenant.config as TenantConfig | null) ?? null }, home, now);
  const result = await makeRead({ auth, scope, facts, tz, now, refreshes: action === "refresh" ? (existing?.refreshes ?? 0) + 1 : 0, opened: true });
  if (result.kind === "paused") return apiSuccess({ ai: true, paused: true, read: existing });
  if (result.kind === "failed") return apiSuccess({ ai: false });
  return apiSuccess({ ai: true, read: result.read });
}
