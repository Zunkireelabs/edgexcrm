import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import { getLeadMembership, canManageLeadBranches } from "@/lib/leads/branch-membership";
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
import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { sendLeadAssignedEmail } from "@/lib/email/send-lead-assigned";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/${id}/branches`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.entitlements.maxBranches <= 1) return apiForbidden();

  let body: { branch_ids?: unknown; assigned_to?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!Array.isArray(body.branch_ids) || body.branch_ids.length === 0) {
    return apiValidationError({ branch_ids: ["Must provide at least one branch ID"] });
  }
  const branchIds = body.branch_ids as string[];
  if (branchIds.some((b) => !UUID_REGEX.test(b))) {
    return apiValidationError({ branch_ids: ["Invalid UUID format"] });
  }

  const assignedTo = body.assigned_to as string | null | undefined;
  if (assignedTo !== undefined && assignedTo !== null && !UUID_REGEX.test(assignedTo)) {
    return apiValidationError({ assigned_to: ["Invalid UUID format"] });
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
  if (!canManageLeadBranches(auth, membership)) return apiForbidden();

  // Validate all branch_ids belong to this tenant
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", auth.tenantId)
    .in("id", branchIds);

  const validBranchMap = new Map(
    (branches ?? []).map((b: { id: string; name: string }) => [b.id, b.name]),
  );
  const invalidBranches = branchIds.filter((b) => !validBranchMap.has(b));
  if (invalidBranches.length > 0) {
    return apiValidationError({ branch_ids: ["One or more branches not found in this tenant"] });
  }

  // Compute only new branches (skip existing membership rows — idempotent)
  const existingBranchIds = new Set(membership.map((m) => m.branch_id));
  const newBranchIds = branchIds.filter((b) => !existingBranchIds.has(b));

  // Validate assigned_to membership in all newly-added target branches.
  // If sharing into multiple branches with assigned_to, the user must be a member of all of them.
  if (assignedTo && newBranchIds.length > 0) {
    for (const branchId of newBranchIds) {
      const { data: branchMember } = await supabase
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", auth.tenantId)
        .eq("user_id", assignedTo)
        .eq("branch_id", branchId)
        .single();
      if (!branchMember) {
        return apiValidationError({
          assigned_to: [`Assigned user is not a member of branch ${validBranchMap.get(branchId) ?? branchId}`],
        });
      }
    }
  }

  // Nothing new to add — return current membership (idempotent)
  if (newBranchIds.length === 0) {
    const current = await getLeadMembership(supabase, auth.tenantId, id);
    return apiSuccess({ membership: current, added: [] });
  }

  const rows = newBranchIds.map((branchId) => ({
    tenant_id: auth.tenantId,
    lead_id: id,
    branch_id: branchId,
    assigned_to: assignedTo ?? null,
    is_origin: false,
    shared_by: auth.userId,
  }));

  const { error: insertError } = await supabase
    .from("lead_branches")
    .upsert(rows, { onConflict: "lead_id,branch_id", ignoreDuplicates: true });
  if (insertError) {
    log.error({ err: insertError }, "Failed to insert lead_branches");
    return apiServiceUnavailable("Failed to share lead");
  }

  log.info({ leadId: id, branches: newBranchIds, assignedTo }, "Lead shared into branches");

  const leadName = `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "A lead";

  Promise.all(
    newBranchIds.flatMap((branchId) => {
      const branchName = validBranchMap.get(branchId) ?? branchId;
      return [
        createAuditLog({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: "lead.branch_shared",
          entityType: "lead",
          entityId: id,
          changes: {
            branch: { old: null, new: branchName },
            ...(assignedTo ? { assigned_to: { old: null, new: assignedTo } } : {}),
          },
          ipAddress: ip,
          userAgent,
          requestId,
        }),
        emitEvent({
          tenantId: auth.tenantId,
          type: "lead.branch_shared",
          entityType: "lead",
          entityId: id,
          payload: {
            branch_id: branchId,
            branch_name: branchName,
            assigned_to: assignedTo ?? null,
          },
          requestId,
        }),
      ];
    }),
  );

  if (assignedTo) {
    const notifications = newBranchIds.map((branchId) => ({
      tenantId: auth.tenantId,
      userId: assignedTo,
      type: NotificationTypes.LEAD_ASSIGNED,
      title: "Lead assigned to you",
      message: `${leadName} has been assigned to you in ${validBranchMap.get(branchId) ?? "a branch"}`,
      link: `/leads/${id}`,
    }));
    createNotificationsExcept(auth.userId, notifications);

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

  const updated = await getLeadMembership(supabase, auth.tenantId, id);
  return apiSuccess({ membership: updated, added: newBranchIds });
}
