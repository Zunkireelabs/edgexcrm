import { NextRequest } from "next/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiError,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";
import {
  resolveRestoreTarget,
  type RestoreList,
  type RestoreStage,
} from "@/industries/education-consultancy/features/archived-lookup/lib/restore-target";
import { onLeadsEnteredStageSafe } from "@/industries/_shared/features/outreach/lib/stage-auto-enroll";

// POST /api/v1/archived-leads/[id]/restore — send an archived lead back to the pipeline.
//
// Who: anyone who can edit leads (everyone except view-only users) — the client asked that any counselor who finds an
// archived lead can send it back, so, like the search that finds it, this is NOT limited to the caller's own leads.
// What: the lead returns to the stage (lead list) it was archived from, at the status it had then — or to the first
// intake stage when that no longer exists — and the archive marks are cleared. The ASSIGNED COUNSELOR IS NOT CHANGED.
// The move is written to the audit log (it shows in the lead's System Activity) and emits lead.list_changed.

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/archived-leads/${id}/restore` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ARCHIVED_LOOKUP)) return apiForbidden();
  if (!auth.permissions.canEditLeads) return apiForbidden(PERMISSION_DENIED_MESSAGE);
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid lead id"] });

  const db = await scopedClient(auth);

  const { data: leadRow } = await db
    .from("leads")
    .select("id, list_id, archived_from_list_id, archived_from_status")
    .eq("id", id)
    .is("deleted_at", null)
    .is("converted_at", null)
    .maybeSingle();
  if (!leadRow) return apiNotFound("Lead");
  const lead = leadRow as unknown as {
    id: string;
    list_id: string | null;
    archived_from_list_id: string | null;
    archived_from_status: string | null;
  };

  const [listsRes, stagesRes] = await Promise.all([
    db.from("lead_lists").select("id, name, slug, is_archive, is_intake, is_staging, pipeline_id, sort_order"),
    db.from("pipeline_stages").select("id, slug, pipeline_id, position, is_default"),
  ]);
  const lists = (listsRes.data ?? []) as unknown as RestoreList[];
  const stages = (stagesRes.data ?? []) as unknown as RestoreStage[];

  const current = lists.find((l) => l.id === lead.list_id);
  if (!current?.is_archive) return apiConflict("This lead is not in Archive");

  const target = resolveRestoreTarget({
    archivedFromListId: lead.archived_from_list_id,
    archivedFromStatus: lead.archived_from_status,
    lists,
    stages,
  });
  if (!target) return apiError("NO_RESTORE_TARGET", "There is no pipeline stage to move this lead back to", 422);

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    list_id: target.listId,
    lead_type: target.leadType,
    stage_changed_at: now,
    last_activity_at: now,
    updated_at: now,
    // Archive marks cleared (archive_reason stays as history, like a manual move out of Archive).
    archived_by: null,
    archived_at: null,
    archived_from_list_id: null,
    archived_from_status: null,
  };
  if (target.stageId) {
    payload.pipeline_id = target.pipelineId;
    payload.stage_id = target.stageId;
    payload.status = target.status;
  }

  // Only move it if it is STILL in the archive stage we read — a second person restoring the same lead at the same
  // moment gets a clear message instead of a silent double move.
  const { data: updated, error } = await db
    .from("leads")
    .update(payload)
    .eq("id", id)
    .eq("list_id", lead.list_id as string)
    .select("id");
  if (error) {
    log.error({ err: error, leadId: id }, "Failed to restore archived lead");
    return apiServiceUnavailable("Failed to move the lead back to the pipeline");
  }
  if (!updated || updated.length === 0) {
    return apiConflict("This lead was just changed by someone else. Refresh and try again.");
  }

  await onLeadsEnteredStageSafe({
    tenantId: auth.tenantId,
    leadIds: [id],
    fromListId: lead.list_id as string | null,
    toListId: target.listId,
  });

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.updated",
      entityType: "lead",
      entityId: id,
      changes: {
        list: { old: current.name, new: target.listName },
        restored_from_archive: { old: false, new: true },
      },
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.list_changed",
      entityType: "lead",
      entityId: id,
      payload: { old_list_id: current.id, new_list_id: target.listId, restored_from_archive: true },
      requestId,
    }),
  ]);

  log.info({ leadId: id, toList: target.listSlug, usedFallback: target.usedFallback }, "Archived lead restored");
  return apiSuccess({
    id,
    list_id: target.listId,
    list_name: target.listName,
    status: target.status,
    used_fallback: target.usedFallback,
  });
}
