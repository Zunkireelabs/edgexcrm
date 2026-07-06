import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/leave/holidays/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("holidays").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Holiday");

  const { error } = await db.from("holidays").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete holiday");
    return apiError("DB_ERROR", "Failed to delete holiday", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "holiday.deleted",
    entityType: "holiday",
    entityId: id,
    requestId,
  });

  log.info({ holidayId: id }, "Holiday deleted");
  return apiSuccess({ id, deleted: true });
}
