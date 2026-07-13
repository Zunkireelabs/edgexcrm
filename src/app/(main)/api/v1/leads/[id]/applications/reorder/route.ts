import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canCreateOrReorderApplications } from "@/lib/api/applications";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog } from "@/lib/api/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/v1/leads/:id/applications/reorder — persist the panel drag order.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/leads/${id}/applications/reorder` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const supabase = await createServiceClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null };

  if (!canCreateOrReorderApplications(auth, leadRow)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const orderedIds = body.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string")) {
    return apiValidationError({ orderedIds: ["orderedIds must be an array of application ids"] });
  }
  const ids = orderedIds as string[];
  if (new Set(ids).size !== ids.length) {
    return apiValidationError({ orderedIds: ["orderedIds contains duplicate ids"] });
  }

  const db = await scopedClient(auth);

  // The complete set of live applications for this lead. The submitted order must
  // be a full permutation of it — reject foreign / missing ids so a stale client
  // can't silently drop or smuggle rows.
  const { data: liveRows, error: liveErr } = await db
    .from("applications")
    .select("id")
    .eq("lead_id", id)
    .is("deleted_at", null);
  if (liveErr) return apiError("DB_ERROR", "Failed to load applications", 500);
  const liveIds = new Set(((liveRows ?? []) as unknown as { id: string }[]).map((r) => r.id));

  if (ids.length !== liveIds.size || ids.some((x) => !liveIds.has(x))) {
    return apiValidationError({ orderedIds: ["orderedIds must list exactly this lead's applications"] });
  }

  // Persist position = index. Each update is scoped to (tenant via wrapper) + lead + id.
  const results = await Promise.all(
    ids.map((appId, index) =>
      db.from("applications").update({ position: index }).eq("id", appId).eq("lead_id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    log.error({ error: failed.error }, "Failed to reorder applications");
    return apiError("DB_ERROR", "Failed to reorder applications", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "application.reordered",
    entityType: "lead",
    entityId: id,
    changes: { order: { old: null, new: ids } },
    requestId,
  });

  log.info({ leadId: id, count: ids.length }, "Applications reordered");
  return apiSuccess({ orderedIds: ids });
}
