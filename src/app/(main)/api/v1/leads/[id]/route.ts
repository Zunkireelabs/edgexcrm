import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { canAccessPipeline, leadQueryScope } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import type { Lead } from "@/types/database";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (error || !lead) {
    log.info({ leadId: id }, "Lead not found");
    return apiNotFound("Lead");
  }

  // Scope enforcement: membership-based (handles §4.1 NULL-branch fallback)
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
  if (scope.restrictToSelf &&
      !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId)) {
    // Collaborators (anyone ever assigned) keep VIEW access even after reassignment.
    const isCollab = await isLeadCollaborator(supabase, auth.tenantId, id, auth.userId);
    // Cross-branch pool: own-scope chain member can view an unassigned cross-branch lead
    // shared into their branch when the lead's list matches their position route.
    let isCrossBranchPoolLead = false;
    if (!isCollab && auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId) {
      const routeSlug = POSITION_ROUTE_MAP[auth.positionSlug];
      // Only sent-in (is_origin=false) shared rows qualify — never the branch's own origin lead.
      const inBranchUnassigned = membership.some((m) => m.branch_id === auth.branchId && m.assigned_to === null && !m.is_origin);
      if (routeSlug && inBranchUnassigned && (lead as Record<string, unknown>).list_id) {
        const { data: listRow } = await supabase
          .from("lead_lists").select("slug")
          .eq("id", (lead as Record<string, unknown>).list_id as string)
          .eq("tenant_id", auth.tenantId)
          .maybeSingle();
        isCrossBranchPoolLead = (listRow as { slug?: string } | null)?.slug === routeSlug;
      }
    }
    if (!isCollab && !isCrossBranchPoolLead) return apiNotFound("Lead");
  }
  if (scope.branchId) {
    const inBranch =
      membership.some((m) => m.branch_id === auth.branchId) ||
      lead.branch_id === auth.branchId ||
      (lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to));
    if (!inBranch) return apiNotFound("Lead");
  }

  // Pipeline-access enforcement (dormant until Phase 3)
  if (!canAccessPipeline(auth.permissions, lead.pipeline_id)) return apiNotFound("Lead");

  return apiSuccess(lead as Lead);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const outcome = await applyLeadPatch(auth, id, body, { requestId, ip, userAgent });

  switch (outcome.kind) {
    case "not_found":
      return apiNotFound("Lead");
    case "forbidden":
      return outcome.message ? apiForbidden(outcome.message) : apiForbidden();
    case "validation":
      return apiValidationError(outcome.errors);
    case "db_error":
      return apiServiceUnavailable("Failed to update lead");
    case "ok":
      return apiSuccess(outcome.lead);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/leads/${id}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    log.info({ leadId: id }, "Lead not found for deletion");
    return apiNotFound("Lead");
  }

  // Soft delete
  const { error } = await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    log.error({ err: error }, "Failed to soft delete lead");
    return apiServiceUnavailable("Failed to delete lead");
  }

  log.info({ leadId: id }, "Lead soft deleted");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.deleted",
      entityType: "lead",
      entityId: id,
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.deleted",
      entityType: "lead",
      entityId: id,
      requestId,
    }),
  ]);

  return apiSuccess({ id, deleted: true });
}
