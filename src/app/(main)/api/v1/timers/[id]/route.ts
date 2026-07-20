import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/timers/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const isAdmin = requireAdmin(auth);

  let query = db.from("active_timers").delete().eq("id", id);
  if (!isAdmin) query = query.eq("user_id", auth.userId);
  const { data: deleted, error } = await query.select("id").maybeSingle();

  if (error) {
    log.error({ error }, "Failed to discard timer");
    return apiError("DB_ERROR", "Failed to discard timer", 500);
  }
  if (!deleted) return apiNotFound("Timer");

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "timer.discarded",
    entityType: "active_timer",
    entityId: id,
    requestId,
  });

  log.info({ timerId: id }, "Timer discarded");
  return apiSuccess({ id });
}
