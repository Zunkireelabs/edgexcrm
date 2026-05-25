import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/time-entries/${id}/approve`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing, error: fetchError } = await db
    .from("time_entries")
    .select("id, approval_status, user_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch time entry", 500);
  if (!existing) return apiNotFound("Time entry");

  const row = existing as unknown as { id: string; approval_status: string; user_id: string };
  if (row.approval_status !== "pending") {
    return apiError("INVALID_STATE", "Only pending entries can be approved", 409);
  }

  const { data: updated, error: updateError } = await db
    .from("time_entries")
    .update({
      approval_status: "approved",
      approved_by: auth.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("*, projects(id, name, account_id, accounts(id, name)), tasks(id, title)")
    .maybeSingle();

  if (updateError) {
    log.error({ error: updateError }, "Failed to approve time entry");
    return apiError("DB_ERROR", "Failed to approve time entry", 500);
  }
  if (!updated) {
    return apiError("INVALID_STATE", "Only pending entries can be approved", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "time_entry.approved",
      entityType: "time_entry",
      entityId: id,
      changes: { approval_status: { old: "pending", new: "approved" } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "time_entry.approved",
      entityType: "time_entry",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ entryId: id }, "Time entry approved");
  return apiSuccess(updated);
}
