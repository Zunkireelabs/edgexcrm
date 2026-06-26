import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { sendLeadAssignedEmail } from "@/lib/email/send-lead-assigned";

type RouteParams = { params: Promise<{ id: string; branchId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id, branchId } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/leads/${id}/branches/${branchId}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.entitlements.maxBranches <= 1) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: row } = await supabase
    .from("lead_branches")
    .select("id, is_origin, branch_id")
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .eq("branch_id", branchId)
    .single();
  if (!row) return apiNotFound("Branch membership");

  if (row.is_origin) {
    return apiError("ORIGIN_PROTECTED", "Cannot remove the origin branch", 422);
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("name")
    .eq("id", branchId)
    .eq("tenant_id", auth.tenantId)
    .single();
  const branchName = branch?.name ?? branchId;

  const { error: deleteError } = await supabase
    .from("lead_branches")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .eq("branch_id", branchId);
  if (deleteError) {
    log.error({ err: deleteError }, "Failed to delete lead_branches row");
    return apiServiceUnavailable("Failed to revoke branch share");
  }

  log.info({ leadId: id, branchId }, "Lead branch share revoked");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.branch_revoked",
      entityType: "lead",
      entityId: id,
      changes: { branch: { old: branchName, new: null } },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.branch_revoked",
      entityType: "lead",
      entityId: id,
      payload: { branch_id: branchId, branch_name: branchName },
      requestId,
    }),
  ]);

  return apiSuccess({ revoked: true, branch_id: branchId });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, branchId } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/${id}/branches/${branchId}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.entitlements.maxBranches <= 1) return apiForbidden();

  let body: { assigned_to?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!("assigned_to" in body)) {
    return apiValidationError({ assigned_to: ["assigned_to is required (use null to clear)"] });
  }
  const assignedTo = body.assigned_to as string | null;
  if (assignedTo !== null && (typeof assignedTo !== "string" || !/^[0-9a-f-]{36}$/i.test(assignedTo))) {
    return apiValidationError({ assigned_to: ["Must be a valid UUID or null"] });
  }

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, assigned_to")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  const membership = await getLeadMembership(supabase, auth.tenantId, id);

  const isAdmin = requireAdmin(auth);
  if (!isAdmin) {
    // Branch manager may only set assignee on their own branch's row,
    // and only when the lead is already held by their branch.
    const isBranchManager =
      auth.permissions.leadScope === "team" && auth.permissions.baseTier === "member";
    if (!isBranchManager) return apiForbidden();
    if (!auth.branchId || branchId !== auth.branchId) return apiForbidden();
    if (!membership.some((m) => m.branch_id === auth.branchId)) return apiForbidden();
  }

  // Load the target membership row — 404 if lead not in this branch
  const { data: memberRow } = await supabase
    .from("lead_branches")
    .select("id, is_origin, assigned_to")
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .eq("branch_id", branchId)
    .single();
  if (!memberRow) return apiNotFound("Branch membership");

  // Validate assignedTo is a member of the target branch (when non-null)
  if (assignedTo !== null) {
    const { data: branchMember } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", assignedTo)
      .eq("branch_id", branchId)
      .single();
    if (!branchMember) {
      return apiValidationError({ assigned_to: ["User is not a member of this branch"] });
    }
  }

  const prevAssignedTo = memberRow.assigned_to as string | null;

  const { error: updateError } = await supabase
    .from("lead_branches")
    .update({ assigned_to: assignedTo })
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .eq("branch_id", branchId);
  if (updateError) {
    log.error({ err: updateError }, "Failed to update branch assignee");
    return apiServiceUnavailable("Failed to update branch assignee");
  }

  // Origin row: mirror assignment to leads.assigned_to (keeps legacy readers in sync)
  if (memberRow.is_origin) {
    await supabase
      .from("leads")
      .update({ assigned_to: assignedTo })
      .eq("id", id)
      .eq("tenant_id", auth.tenantId);
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("name")
    .eq("id", branchId)
    .eq("tenant_id", auth.tenantId)
    .single();
  const branchName = branch?.name ?? branchId;

  log.info({ leadId: id, branchId, prevAssignedTo, assignedTo }, "Branch assignee updated");

  const leadName = `${(lead as { first_name?: string | null }).first_name || ""} ${(lead as { last_name?: string | null }).last_name || ""}`.trim() || "A lead";

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.branch_assigned",
      entityType: "lead",
      entityId: id,
      changes: {
        branch: { old: null, new: branchName },
        assigned_to: { old: prevAssignedTo, new: assignedTo },
      },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.branch_assigned",
      entityType: "lead",
      entityId: id,
      payload: { branch_id: branchId, branch_name: branchName, assigned_to: assignedTo },
      requestId,
    }),
  ]);

  const notifs = [];

  if (assignedTo) {
    notifs.push({
      tenantId: auth.tenantId,
      userId: assignedTo,
      type: NotificationTypes.LEAD_ASSIGNED,
      title: "Lead assigned to you",
      message: `${leadName} has been assigned to you in ${branchName}`,
      link: `/leads/${id}`,
    });

    (async () => {
      try {
        const { data: assignee } = await supabase.auth.admin.getUserById(assignedTo);
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name, primary_color")
          .eq("id", auth.tenantId)
          .single();
        if (assignee?.user?.email && tenant) {
          sendLeadAssignedEmail({
            to: assignee.user.email,
            assignerEmail: auth.email || "admin",
            tenantName: tenant.name,
            leadId: id,
            leadName,
            leadEmail: (lead as { email?: string | null }).email ?? undefined,
            primaryColor: tenant.primary_color || undefined,
          }).catch((err) => log.error({ err }, "Failed to send lead assigned email"));
        }
      } catch (err) {
        log.error({ err }, "Error fetching data for lead assigned email");
      }
    })();
  }

  if (prevAssignedTo && prevAssignedTo !== assignedTo) {
    notifs.push({
      tenantId: auth.tenantId,
      userId: prevAssignedTo,
      type: NotificationTypes.LEAD_UNASSIGNED,
      title: "Lead reassigned",
      message: `${leadName} has been reassigned to someone else`,
      link: `/leads/${id}`,
    });
  }

  if (notifs.length > 0) createNotificationsExcept(auth.userId, notifs);

  return apiSuccess({
    branch_id: branchId,
    assigned_to: assignedTo,
    is_origin: memberRow.is_origin,
  });
}
