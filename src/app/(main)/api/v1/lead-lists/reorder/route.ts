import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createRequestLogger } from "@/lib/logger";

export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/lead-lists/reorder" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const order = body.order;
  if (!Array.isArray(order) || order.length === 0 || order.some((id) => typeof id !== "string")) {
    return apiValidationError({ order: ["order must be a non-empty array of list ids"] });
  }

  const db = await scopedClient(auth);

  const { data: tenantLists, error: fetchError } = await db.from("lead_lists").select("id");
  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch lead lists");
    return apiServiceUnavailable("Failed to reorder lead lists");
  }

  const tenantIds = new Set((tenantLists as unknown as { id: string }[]).map((l) => l.id));
  if (order.some((id) => !tenantIds.has(id))) {
    return apiValidationError({ order: ["order contains an id that does not belong to this tenant"] });
  }

  const results = await Promise.all(
    order.map((id, index) => db.from("lead_lists").update({ sort_order: index }).eq("id", id))
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    log.error({ err: failed.error }, "Failed to persist lead list order");
    return apiServiceUnavailable("Failed to reorder lead lists");
  }

  log.info({ count: order.length }, "Lead lists reordered");
  return apiSuccess({ order });
}
