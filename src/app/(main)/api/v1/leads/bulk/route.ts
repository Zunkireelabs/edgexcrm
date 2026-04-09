import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { createNotification, NotificationTypes } from "@/lib/notifications";
import { sendBulkAssignedEmail } from "@/lib/email/send-lead-assigned";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/v1/leads/bulk
 * Bulk update leads (e.g., assign to a team member)
 */
export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: "/api/v1/leads/bulk",
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { ids?: string[]; assigned_to?: string | null };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  // Validate IDs
  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return apiValidationError({ ids: ["Must provide an array of lead IDs"] });
  }

  if (body.ids.length > 100) {
    return apiValidationError({ ids: ["Cannot update more than 100 leads at once"] });
  }

  const invalidIds = body.ids.filter((id) => !UUID_REGEX.test(id));
  if (invalidIds.length > 0) {
    return apiValidationError({ ids: ["Invalid UUID format in IDs"] });
  }

  // Validate assigned_to if provided (can be null to unassign)
  if (body.assigned_to !== undefined && body.assigned_to !== null) {
    if (!UUID_REGEX.test(body.assigned_to)) {
      return apiValidationError({ assigned_to: ["Invalid UUID format"] });
    }
  }

  const supabase = await createServiceClient();

  // If assigning to someone, verify they are a tenant member
  if (body.assigned_to) {
    const { data: member } = await supabase
      .from("tenant_users")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", body.assigned_to)
      .single();

    if (!member) {
      return apiValidationError({ assigned_to: ["User is not a member of this tenant"] });
    }
  }

  // Verify all leads exist and belong to tenant
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id, assigned_to")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .in("id", body.ids);

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch leads for bulk update");
    return apiServiceUnavailable("Failed to verify leads");
  }

  const existingMap = new Map(existingLeads?.map((l) => [l.id, l.assigned_to]) || []);
  const notFoundIds = body.ids.filter((id) => !existingMap.has(id));

  if (notFoundIds.length > 0) {
    log.info({ notFoundIds }, "Some leads not found for bulk update");
  }

  // Only update leads that exist
  const idsToUpdate = body.ids.filter((id) => existingMap.has(id));

  if (idsToUpdate.length === 0) {
    return apiValidationError({ ids: ["No valid leads found to update"] });
  }

  // Update all leads
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      assigned_to: body.assigned_to ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", auth.tenantId)
    .in("id", idsToUpdate);

  if (updateError) {
    log.error({ err: updateError }, "Failed to bulk update leads");
    return apiServiceUnavailable("Failed to update leads");
  }

  log.info(
    { count: idsToUpdate.length, ids: idsToUpdate, assigned_to: body.assigned_to },
    "Bulk updated leads"
  );

  // Create audit logs and events for each updated lead
  Promise.all(
    idsToUpdate.flatMap((id) => [
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "lead.updated",
        entityType: "lead",
        entityId: id,
        changes: {
          assigned_to: { old: existingMap.get(id) || null, new: body.assigned_to ?? null },
        },
        ipAddress: ip,
        userAgent,
        requestId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: body.assigned_to ? "lead.assigned" : "lead.unassigned",
        entityType: "lead",
        entityId: id,
        payload: { assigned_to: body.assigned_to ?? null },
        requestId,
      }),
    ])
  );

  // Create notification for new assignee (single notification for bulk)
  if (body.assigned_to) {
    createNotification({
      tenantId: auth.tenantId,
      userId: body.assigned_to,
      type: NotificationTypes.LEAD_ASSIGNED,
      title: `${idsToUpdate.length} leads assigned to you`,
      message: `You have been assigned ${idsToUpdate.length} new lead${idsToUpdate.length !== 1 ? "s" : ""}`,
      link: "/leads",
    });

    // Send bulk assignment email (fire and forget)
    (async () => {
      try {
        const { data: assignee } = await supabase.auth.admin.getUserById(body.assigned_to as string);
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name, primary_color")
          .eq("id", auth.tenantId)
          .single();

        if (assignee?.user?.email && tenant) {
          sendBulkAssignedEmail({
            to: assignee.user.email,
            assignerEmail: auth.email || "admin",
            tenantName: tenant.name,
            leadCount: idsToUpdate.length,
            primaryColor: tenant.primary_color || undefined,
          }).catch((err) => {
            log.error({ err }, "Failed to send bulk assigned email");
          });
        }
      } catch (err) {
        log.error({ err }, "Error fetching data for bulk assigned email");
      }
    })();
  }

  // Notify previous assignees who lost their leads (group by previous assignee)
  const previousAssignees = new Map<string, number>();
  for (const id of idsToUpdate) {
    const prevAssignee = existingMap.get(id);
    if (prevAssignee && prevAssignee !== body.assigned_to) {
      previousAssignees.set(prevAssignee, (previousAssignees.get(prevAssignee) || 0) + 1);
    }
  }

  for (const [prevUserId, count] of previousAssignees) {
    createNotification({
      tenantId: auth.tenantId,
      userId: prevUserId,
      type: NotificationTypes.LEAD_UNASSIGNED,
      title: `${count} lead${count !== 1 ? "s" : ""} reassigned`,
      message: `${count} lead${count !== 1 ? "s have" : " has"} been reassigned to someone else`,
      link: "/leads",
    });
  }

  return apiSuccess({
    updated: idsToUpdate.length,
    ids: idsToUpdate,
    assigned_to: body.assigned_to ?? null,
    notFound: notFoundIds,
  });
}

export async function DELETE(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: "/api/v1/leads/bulk",
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return apiValidationError({ ids: ["Must provide an array of lead IDs"] });
  }

  if (body.ids.length > 100) {
    return apiValidationError({ ids: ["Cannot delete more than 100 leads at once"] });
  }

  // Validate all IDs are valid UUIDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = body.ids.filter((id) => !uuidRegex.test(id));
  if (invalidIds.length > 0) {
    return apiValidationError({ ids: ["Invalid UUID format in IDs"] });
  }

  const supabase = await createServiceClient();

  // Verify all leads exist and belong to tenant
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .in("id", body.ids);

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch leads for bulk delete");
    return apiServiceUnavailable("Failed to verify leads");
  }

  const existingIds = new Set(existingLeads?.map((l) => l.id) || []);
  const notFoundIds = body.ids.filter((id) => !existingIds.has(id));

  if (notFoundIds.length > 0) {
    log.info({ notFoundIds }, "Some leads not found for bulk delete");
  }

  // Only delete leads that exist
  const idsToDelete = body.ids.filter((id) => existingIds.has(id));

  if (idsToDelete.length === 0) {
    return apiValidationError({ ids: ["No valid leads found to delete"] });
  }

  // Soft delete all leads
  const { error: deleteError } = await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("tenant_id", auth.tenantId)
    .in("id", idsToDelete);

  if (deleteError) {
    log.error({ err: deleteError }, "Failed to bulk soft delete leads");
    return apiServiceUnavailable("Failed to delete leads");
  }

  log.info({ count: idsToDelete.length, ids: idsToDelete }, "Bulk soft deleted leads");

  // Create audit logs and events for each deleted lead
  Promise.all(
    idsToDelete.flatMap((id) => [
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
    ])
  );

  return apiSuccess({
    deleted: idsToDelete.length,
    ids: idsToDelete,
    notFound: notFoundIds,
  });
}
