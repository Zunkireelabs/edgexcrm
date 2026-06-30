import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, requireLeadAccess, getClientIp } from "@/lib/api/auth";
import { getLeadMembership, syncOriginMembership } from "@/lib/leads/branch-membership";
import { addLeadCollaborator, isLeadCollaborator } from "@/lib/leads/collaborators";
import { canAccessPipeline, canAccessList, leadQueryScope } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { normalizeEmail } from "@/lib/leads/dedup";
import { assignDisplayIds } from "@/lib/leads/assign-display-ids";
import { createRequestLogger } from "@/lib/logger";
import {
  createNotificationsExcept,
  getTenantAdminRecipients,
  NotificationTypes,
} from "@/lib/notifications";
import { sendLeadAssignedEmail } from "@/lib/email/send-lead-assigned";
import { processEmailForwardRules } from "@/lib/email/email-forward";
import type { Lead } from "@/types/database";

const UPDATABLE_FIELDS = [
  "status",
  "stage_id",
  "pipeline_id",
  "assigned_to",
  "branch_id",
  "first_name",
  "last_name",
  "email",
  "phone",
  "city",
  "country",
  "custom_fields",
  "file_urls",
  "step",
  "is_final",
  "intake_source",
  "intake_medium",
  "intake_account",
  "intake_campaign",
  "nationality",
  "preferred_contact_method",
  "tags",
  "lead_type",
  "company_name",
  "designation",
  "prospect_industry",
  "owner_id",
  "salutation",
  "company_email",
  "entity_id",
  "list_id",
  "archive_reason",
  "destinations",
  "field_of_study",
  "degree_level",
  "pre_app_fee_status",
  "pre_app_fee_amount",
  "pre_app_fee_notes",
] as const;

// Blocked for plain counselors/viewers but NOT for team-scoped branch managers
// (who have their own §4.2 guard below).
const ADMIN_ONLY_FIELDS = ["assigned_to", "owner_id", "branch_id"];

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
    if (!isCollab) return apiNotFound("Lead");
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
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/${id}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const supabase = await createServiceClient();

  // Fetch existing lead for audit diff + access check
  const { data: existingLead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    log.info({ leadId: id }, "Lead not found for update");
    return apiNotFound("Lead");
  }

  // Pipeline-access enforcement (dormant until Phase 3)
  if (!canAccessPipeline(auth.permissions, existingLead.pipeline_id)) return apiForbidden();

  // Access check: admin or counselor with assignment
  const patchMembership = await getLeadMembership(supabase, auth.tenantId, id);
  if (!requireLeadAccess(auth, existingLead, patchMembership)) {
    return apiForbidden();
  }

  // Plain counselors cannot update admin-only fields.
  // Team-scoped branch managers CAN (subject to the §4.2 guard that follows).
  if (auth.permissions.baseTier === "member" && auth.permissions.leadScope !== "team") {
    // canAssignLeads lets a member set the assignee (assigned_to); branch/owner stay admin-only.
    const blockedFields = auth.permissions.canAssignLeads
      ? ADMIN_ONLY_FIELDS.filter((f) => f !== "assigned_to")
      : ADMIN_ONLY_FIELDS;
    for (const field of blockedFields) {
      if (body[field] !== undefined) {
        return apiForbidden();
      }
    }
  }

  // Dual-mode status/stage_id resolution
  if (body.status !== undefined && body.stage_id !== undefined) {
    return apiValidationError({
      status: ["Cannot provide both status and stage_id. Use one or the other."],
    });
  }

  if (body.status && typeof body.status === "string") {
    // Resolve stage_id from status slug
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", body.status)
      .single();

    if (!stage) {
      return apiValidationError({
        status: [`Invalid status: "${body.status}". No matching pipeline stage found.`],
      });
    }

    body.stage_id = stage.id;
  } else if (body.stage_id && typeof body.stage_id === "string") {
    // Resolve status slug from stage_id; when the lead is in a list, validate
    // the stage belongs to that list's pipeline.
    let stageQuery = supabase
      .from("pipeline_stages")
      .select("slug, pipeline_id")
      .eq("id", body.stage_id)
      .eq("tenant_id", auth.tenantId);

    // If the lead currently belongs to a list, scope to that list's pipeline
    const currentPipelineId = (existingLead as Record<string, unknown>).pipeline_id as string | null;
    if (currentPipelineId) {
      stageQuery = stageQuery.eq("pipeline_id", currentPipelineId);
    }

    const { data: stage } = await stageQuery.single();

    if (!stage) {
      return apiValidationError({
        stage_id: ["Invalid stage_id. Stage does not belong to this lead's pipeline."],
      });
    }

    body.status = stage.slug;
  }

  // Validate assigned_to: must be a tenant member
  if (body.assigned_to !== undefined && body.assigned_to !== null) {
    const { data: memberCheck } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", body.assigned_to as string)
      .single();

    if (!memberCheck) {
      return apiValidationError({
        assigned_to: ["Assigned user is not a member of this tenant"],
      });
    }
  }

  // Validate owner_id: must be a tenant member if provided
  if (body.owner_id !== undefined && body.owner_id !== null) {
    const { data: ownerCheck } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", body.owner_id as string)
      .single();

    if (!ownerCheck) {
      return apiValidationError({
        owner_id: ["Owner is not a member of this tenant"],
      });
    }
  }

  // Validate entity_id: must belong to this tenant if provided (null clears it)
  if (body.entity_id !== undefined && body.entity_id !== null) {
    const { data: entityCheck } = await supabase
      .from("tenant_entities")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("id", body.entity_id as string)
      .single();

    if (!entityCheck) {
      return apiValidationError({
        entity_id: ["Entity not found in this tenant"],
      });
    }
  }

  // Validate branch_id: must belong to this tenant if provided (null clears it)
  if (body.branch_id !== undefined && body.branch_id !== null) {
    const { data: branchCheck } = await supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("id", body.branch_id as string)
      .single();

    if (!branchCheck) {
      return apiValidationError({
        branch_id: ["Branch not found in this tenant"],
      });
    }
  }

  // §4.2 Branch-manager assignment guard: a team-scoped non-admin can only set
  // assigned_to / branch_id when the lead is already in their branch, and the
  // target user (if assigning) must also be in their branch. Admins bypass.
  if (auth.permissions.leadScope === "team" && auth.permissions.baseTier === "member") {
    const touchingBranchFields =
      body.assigned_to !== undefined || body.branch_id !== undefined;
    if (touchingBranchFields) {
      const leadInManagerBranch =
        existingLead.branch_id === auth.branchId ||
        patchMembership.some((m) => m.branch_id === auth.branchId);
      if (!auth.branchId || !leadInManagerBranch) {
        return apiForbidden();
      }
      if (body.assigned_to !== undefined && body.assigned_to !== null) {
        const { data: targetMember } = await supabase
          .from("tenant_users")
          .select("branch_id")
          .eq("tenant_id", auth.tenantId)
          .eq("user_id", body.assigned_to as string)
          .single();
        if (!targetMember || targetMember.branch_id !== auth.branchId) {
          return apiForbidden();
        }
      }
      // Branch manager may only set branch_id to their own branch (or clear it)
      if (body.branch_id !== undefined && body.branch_id !== null && body.branch_id !== auth.branchId) {
        return apiForbidden();
      }
    }
  }

  // Validate list_id: must belong to this tenant and be accessible to the caller
  if (body.list_id !== undefined && body.list_id !== null) {
    if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) {
      return apiForbidden();
    }
    const { data: listCheck } = await supabase
      .from("lead_lists")
      .select("id, slug, is_archive, access")
      .eq("tenant_id", auth.tenantId)
      .eq("id", body.list_id as string)
      .maybeSingle();
    if (!listCheck) {
      return apiValidationError({ list_id: ["List not found in this tenant"] });
    }
    const accessible = canAccessList(
      auth.permissions,
      listCheck.access as { mode: string; positionIds?: string[] },
      auth.positionId,
      listCheck.id,
    );
    if (!accessible) return apiForbidden();
  }

  // Build update payload from whitelist
  const updatePayload: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) {
      updatePayload[field] = body[field];
    }
  }

  // Mirror lead_type on list move (keeps existing education UI working during transition)
  // Also resolve list names for the audit log so the activity timeline can render them.
  let newListName: string | null = null;
  let oldListName: string | null = null;
  if (updatePayload.list_id !== undefined && updatePayload.list_id !== null) {
    const { data: targetList } = await supabase
      .from("lead_lists")
      .select("id, slug, name, pipeline_id")
      .eq("id", updatePayload.list_id as string)
      .maybeSingle();
    if (targetList) {
      updatePayload.lead_type = targetList.slug === "prospects" ? "prospect" : "lead";
      newListName = targetList.name;
      // Reset stage to the destination list's default stage on list move
      if (targetList.pipeline_id) {
        const { data: defaultStage } = await supabase
          .from("pipeline_stages")
          .select("id, slug")
          .eq("pipeline_id", targetList.pipeline_id)
          .eq("is_default", true)
          .single();
        if (defaultStage) {
          updatePayload.pipeline_id = targetList.pipeline_id;
          updatePayload.stage_id = defaultStage.id;
          updatePayload.status = defaultStage.slug;
        }
      }
    }
  }
  if ((existingLead as Record<string, unknown>).list_id) {
    const { data: oldList } = await supabase
      .from("lead_lists")
      .select("name")
      .eq("id", (existingLead as Record<string, unknown>).list_id as string)
      .maybeSingle();
    if (oldList) oldListName = oldList.name;
  }

  // Recompute normalized_email when email changes to keep dedup keying accurate
  if (body.email !== undefined) {
    updatePayload.normalized_email = normalizeEmail(body.email as string | null | undefined);
  }

  // Pre-Application fee normalization (migration 084)
  if (updatePayload.pre_app_fee_status !== undefined) {
    const fs = updatePayload.pre_app_fee_status;
    if (fs !== null && !["paid", "unpaid", "waiver"].includes(fs as string)) {
      return apiValidationError({ pre_app_fee_status: ["Must be one of: paid, unpaid, waiver"] });
    }
    // Amount only makes sense when paid — drop it otherwise to keep data clean.
    if (fs !== "paid") updatePayload.pre_app_fee_amount = null;
  }
  if (updatePayload.pre_app_fee_amount !== undefined && updatePayload.pre_app_fee_amount !== null) {
    const amt = Number(updatePayload.pre_app_fee_amount);
    updatePayload.pre_app_fee_amount = Number.isFinite(amt) && amt >= 0 ? amt : null;
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update lead");
    return apiServiceUnavailable("Failed to update lead");
  }

  // Keep lead_branches origin row in sync with leads.branch_id / leads.assigned_to
  if (updatePayload.branch_id !== undefined || updatePayload.assigned_to !== undefined) {
    await syncOriginMembership(supabase, auth.tenantId, id, (updated as Lead).branch_id ?? null, (updated as Lead).assigned_to ?? null);
  }

  // New assignee becomes a permanent collaborator (engaged-user visibility).
  if (updatePayload.assigned_to !== undefined && (updated as Lead).assigned_to) {
    try {
      await addLeadCollaborator(supabase, auth.tenantId, id, (updated as Lead).assigned_to);
    } catch (err) {
      log.error({ err }, "addLeadCollaborator on assign failed");
    }
  }

  // Assign display ID to education leads moving out of staging (best-effort).
  const listMovedToNonNull =
    updatePayload.list_id !== undefined &&
    updatePayload.list_id !== null &&
    (existingLead as Record<string, unknown>).list_id !== updatePayload.list_id;
  if (listMovedToNonNull) {
    try {
      await assignDisplayIds({
        supabase,
        tenantId: auth.tenantId,
        industryId: auth.industryId,
        destinationListId: updatePayload.list_id as string,
        leadIds: [id],
      });
    } catch (err) {
      log.error({ err }, "assignDisplayIds failed");
    }
  }

  // Build audit diff
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of Object.keys(updatePayload)) {
    // Skip lead_type — it's an implementation detail mirrored from list moves
    if (field === "lead_type" && updatePayload.list_id !== undefined) continue;
    const oldVal = (existingLead as Record<string, unknown>)[field];
    const newVal = (updated as Record<string, unknown>)[field];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { old: oldVal, new: newVal };
    }
  }

  // Replace UUID list_id diff with human-readable list names for the activity timeline
  const listChanged =
    updatePayload.list_id !== undefined &&
    (existingLead as Record<string, unknown>).list_id !== updated.list_id;
  if (listChanged && newListName !== null) {
    delete changes.list_id;
    changes.list = { old: oldListName, new: newListName };
    if (updated.archive_reason) {
      changes.archive_reason = { old: null, new: updated.archive_reason };
    }
  }

  log.info({ leadId: id, changes }, "Lead updated");

  const statusChanged = body.status && body.status !== existingLead.status;
  const assignedChanged =
    updatePayload.assigned_to !== undefined &&
    existingLead.assigned_to !== updated.assigned_to;

  Promise.all([
    ...(Object.keys(changes).length > 0
      ? [createAuditLog({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: "lead.updated",
          entityType: "lead",
          entityId: id,
          changes,
          ipAddress: ip,
          userAgent,
          requestId,
        })]
      : []),
    ...(statusChanged
      ? [
          emitEvent({
            tenantId: auth.tenantId,
            type: "lead.status_changed",
            entityType: "lead",
            entityId: id,
            payload: {
              old_status: existingLead.status,
              new_status: body.status,
            },
            requestId,
          }),
        ]
      : []),
    ...(assignedChanged
      ? [
          emitEvent({
            tenantId: auth.tenantId,
            type: "lead.assigned",
            entityType: "lead",
            entityId: id,
            payload: {
              old_assigned_to: existingLead.assigned_to,
              new_assigned_to: updated.assigned_to,
            },
            requestId,
          }),
        ]
      : []),
    // Lead assignment history: only true user→user handoffs (both ends non-null),
    // snapshotting each user's position at the moment of the handoff.
    ...(assignedChanged && existingLead.assigned_to && updated.assigned_to
      ? [
          (async () => {
            const { data: members } = await supabase
              .from("tenant_users")
              .select("user_id, position_id")
              .eq("tenant_id", auth.tenantId)
              .in("user_id", [existingLead.assigned_to, updated.assigned_to]);
            const byUser = new Map<string, string | null>(
              (members ?? []).map((m) => [m.user_id as string, (m.position_id as string | null) ?? null])
            );
            await supabase.from("lead_assignment_history").insert({
              tenant_id: auth.tenantId,
              lead_id: id,
              from_user_id: existingLead.assigned_to,
              to_user_id: updated.assigned_to,
              from_position_id: byUser.get(existingLead.assigned_to) ?? null,
              to_position_id: byUser.get(updated.assigned_to) ?? null,
              changed_by: auth.userId,
            });
          })(),
        ]
      : []),
    ...(listChanged
      ? [
          emitEvent({
            tenantId: auth.tenantId,
            type: "lead.list_changed",
            entityType: "lead",
            entityId: id,
            payload: {
              old_list_id: (existingLead as Record<string, unknown>).list_id,
              new_list_id: updated.list_id,
              archive_reason: updated.archive_reason ?? null,
            },
            requestId,
          }),
        ]
      : []),
  ]);

  // Trigger email auto-forward rules on stage change (fire-and-forget)
  const stageChanged = updated.stage_id && updated.stage_id !== existingLead.stage_id;
  if (stageChanged) {
    processEmailForwardRules({
      tenantId: auth.tenantId,
      lead: updated as Lead,
      newStageId: updated.stage_id,
    }).catch((err) => {
      log.error({ err }, "Email forward processing failed");
    });
  }

  const leadName = `${updated.first_name || ""} ${updated.last_name || ""}`.trim() || "A lead";

  // Create notifications for assignment changes (self-suppressed)
  if (assignedChanged) {
    const assignNotifications = [];

    if (updated.assigned_to) {
      assignNotifications.push({
        tenantId: auth.tenantId,
        userId: updated.assigned_to,
        type: NotificationTypes.LEAD_ASSIGNED,
        title: "Lead assigned to you",
        message: `${leadName} has been assigned to you`,
        link: `/leads/${id}`,
      });

      // Send email to new assignee (fire and forget)
      (async () => {
        try {
          const { data: assignee } = await supabase.auth.admin.getUserById(updated.assigned_to);
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
              leadEmail: updated.email || undefined,
              primaryColor: tenant.primary_color || undefined,
            }).catch((err) => {
              log.error({ err }, "Failed to send lead assigned email");
            });
          }
        } catch (err) {
          log.error({ err }, "Error fetching data for lead assigned email");
        }
      })();
    }

    if (existingLead.assigned_to && existingLead.assigned_to !== updated.assigned_to) {
      assignNotifications.push({
        tenantId: auth.tenantId,
        userId: existingLead.assigned_to,
        type: NotificationTypes.LEAD_UNASSIGNED,
        title: "Lead reassigned",
        message: `${leadName} has been reassigned to someone else`,
        link: `/leads/${id}`,
      });
    }

    createNotificationsExcept(auth.userId, assignNotifications);
  }

  // Notify on stage change (assignee + admins on terminal stages)
  if (stageChanged) {
    const { data: newStage } = await supabase
      .from("pipeline_stages")
      .select("is_terminal")
      .eq("id", updated.stage_id)
      .eq("tenant_id", auth.tenantId)
      .single();

    const stageNotifications = [];
    const stageName = updated.status ?? "a new stage";

    if (updated.assigned_to) {
      stageNotifications.push({
        tenantId: auth.tenantId,
        userId: updated.assigned_to,
        type: NotificationTypes.LEAD_STAGE_CHANGED,
        title: "Lead stage updated",
        message: `${leadName} moved to ${stageName}`,
        link: `/leads/${id}`,
      });
    }

    // On terminal stage, also notify all admins
    if (newStage?.is_terminal) {
      const adminIds = await getTenantAdminRecipients(supabase, auth.tenantId);
      for (const adminId of adminIds) {
        stageNotifications.push({
          tenantId: auth.tenantId,
          userId: adminId,
          type: NotificationTypes.LEAD_STAGE_CHANGED,
          title: "Lead reached terminal stage",
          message: `${leadName} moved to ${stageName}`,
          link: `/leads/${id}`,
        });
      }
    }

    createNotificationsExcept(auth.userId, stageNotifications);
  }

  return apiSuccess(updated as Lead);
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
