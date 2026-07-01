import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { removeLeadCollaborator } from "@/lib/leads/collaborators";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import type { Lead } from "@/types/database";

interface MoveLogRow {
  id: string;
  created_at: string;
  prev_list_id: string | null;
  prev_pipeline_id: string | null;
  prev_stage_id: string | null;
  prev_status: string | null;
  prev_lead_type: string | null;
  prev_archive_reason: string | null;
  prev_assigned_to: string | null;
  new_list_id: string | null;
  new_assigned_to: string | null;
  collaborator_added_user_id: string | null;
}

// Gate: owner/admin, or a team-scoped branch manager whose branch contains the lead.
async function canManageMove(
  auth: Awaited<ReturnType<typeof authenticateRequest>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  lead: { branch_id: string | null; assigned_to: string | null },
  leadId: string,
): Promise<boolean> {
  if (!auth) return false;
  if (auth.role === "owner" || auth.role === "admin") return true;
  const isTeamScoped = auth.permissions.leadScope === "team" && auth.permissions.baseTier === "member";
  if (!isTeamScoped || !auth.branchId) return false; // §4.1: no branch scope, no access
  const membership = await getLeadMembership(supabase, auth.tenantId, leadId);
  return (
    lead.branch_id === auth.branchId ||
    membership.some((m) => m.branch_id === auth.branchId) ||
    (lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to))
  );
}

async function loadLatestMove(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  leadId: string,
): Promise<MoveLogRow | null> {
  const { data } = await supabase
    .from("lead_move_log")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .is("reverted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as MoveLogRow | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, branch_id, assigned_to")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");

  if (!(await canManageMove(auth, supabase, lead, id))) {
    return apiSuccess({ lastMove: null });
  }

  const lastMove = await loadLatestMove(supabase, auth.tenantId, id);
  return apiSuccess({ lastMove });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/${id}/revert-move`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  const { data: existingLead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!existingLead) return apiNotFound("Lead");

  if (!(await canManageMove(auth, supabase, existingLead, id))) {
    return apiForbidden();
  }

  const moveLog = await loadLatestMove(supabase, auth.tenantId, id);
  if (!moveLog) {
    return apiValidationError({ move: ["No move to undo for this lead"] });
  }

  const revertPayload = {
    list_id: moveLog.prev_list_id,
    pipeline_id: moveLog.prev_pipeline_id,
    stage_id: moveLog.prev_stage_id,
    status: moveLog.prev_status,
    lead_type: moveLog.prev_lead_type,
    archive_reason: moveLog.prev_archive_reason,
    assigned_to: moveLog.prev_assigned_to,
  };

  const { data: reverted, error } = await supabase
    .from("leads")
    .update(revertPayload)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error || !reverted) {
    log.error({ err: error }, "Failed to revert lead move");
    return apiServiceUnavailable("Failed to undo move");
  }

  // Revoke exactly the collaborator grant this move caused — earlier legitimate
  // collaborators (assigned before this move) are untouched.
  if (moveLog.collaborator_added_user_id) {
    try {
      await removeLeadCollaborator(supabase, auth.tenantId, id, moveLog.collaborator_added_user_id);
    } catch (err) {
      log.error({ err }, "removeLeadCollaborator on revert failed");
    }
  }

  await supabase
    .from("lead_move_log")
    .update({ reverted_at: new Date().toISOString(), reverted_by: auth.userId })
    .eq("id", moveLog.id);

  log.info({ leadId: id, moveLogId: moveLog.id }, "Lead move undone");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.move_undone",
      entityType: "lead",
      entityId: id,
      changes: {
        list_id: { old: existingLead.list_id, new: reverted.list_id },
        assigned_to: { old: existingLead.assigned_to, new: reverted.assigned_to },
        stage_id: { old: existingLead.stage_id, new: reverted.stage_id },
      },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.move_undone",
      entityType: "lead",
      entityId: id,
      payload: { move_log_id: moveLog.id },
      requestId,
    }),
  ]);

  return apiSuccess(reverted as Lead);
}
