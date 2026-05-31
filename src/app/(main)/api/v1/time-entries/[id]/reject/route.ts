import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/time-entries/${id}/reject`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    reason: [required("reason"), maxLength(500)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing, error: fetchError } = await db
    .from("time_entries")
    .select("id, approval_status, user_id, project_id, minutes")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch time entry", 500);
  if (!existing) return apiNotFound("Time entry");

  const row = existing as unknown as { id: string; approval_status: string; user_id: string; project_id: string; minutes: number };
  if (row.approval_status !== "pending") {
    return apiError("INVALID_STATE", "Only pending entries can be rejected", 409);
  }

  const reason = String(body.reason).trim();

  const { data: updated, error: updateError } = await db
    .from("time_entries")
    .update({
      approval_status: "rejected",
      rejection_reason: reason,
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("*, projects(id, name, account_id, accounts(id, name)), tasks(id, title)")
    .maybeSingle();

  if (updateError) {
    log.error({ error: updateError }, "Failed to reject time entry");
    return apiError("DB_ERROR", "Failed to reject time entry", 500);
  }
  if (!updated) {
    return apiError("INVALID_STATE", "Only pending entries can be rejected", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "time_entry.rejected",
      entityType: "time_entry",
      entityId: id,
      changes: {
        approval_status: { old: "pending", new: "rejected" },
        rejection_reason: { old: null, new: reason },
      },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "time_entry.rejected",
      entityType: "time_entry",
      entityId: id,
      requestId,
      payload: (() => {
        const u = updated as unknown as { projects: { account_id: string | null } | null };
        return { user_id: row.user_id, project_id: row.project_id, minutes: row.minutes, account_id: u.projects?.account_id ?? null, rejection_reason: reason };
      })(),
    }),
  ]);

  log.info({ entryId: id }, "Time entry rejected");
  return apiSuccess(updated);
}
