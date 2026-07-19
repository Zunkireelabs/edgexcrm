import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import { syncOriginMembership } from "@/lib/leads/branch-membership";
import { addLeadCollaborators } from "@/lib/leads/collaborators";
import { assignDisplayIds } from "@/lib/leads/assign-display-ids";
import { getPipelineLandingStage } from "@/lib/leads/pipeline-stage";
import { canAccessList } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { ASSIGN_CHAIN_POSITIONS, assignableTargetSlugs } from "@/industries/education-consultancy/lead-assignment-chain";
import { sendBulkAssignedEmail } from "@/lib/email/send-lead-assigned";
import { hasProspectQualification, canBypassProspectQualification } from "@/lib/leads/prospect-qualification";

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

  const isAdmin = requireAdmin(auth);
  const isTeamScoped =
    auth.permissions.leadScope === "team" && auth.permissions.baseTier === "member";
  if (!isAdmin && !isTeamScoped) return apiForbidden();
  // §4.1: team-scoped member with no branchId has no branch scope — disallow bulk ops
  if (isTeamScoped && !auth.branchId) return apiForbidden();

  let body: {
    ids?: string[];
    assigned_to?: string | null;
    branch_id?: string | null;
    list_id?: string | null;
    archive_reason?: string;
    /** it_agency: Fit-Qualified → Sales Leads graduation. Labels the audit/event distinctly. */
    graduate?: boolean;
  };
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

  // Validate branch_id if provided (can be null to clear)
  if (body.branch_id !== undefined && body.branch_id !== null) {
    if (!UUID_REGEX.test(body.branch_id)) {
      return apiValidationError({ branch_id: ["Invalid UUID format"] });
    }
  }

  // Validate list_id if provided
  if (body.list_id !== undefined && body.list_id !== null) {
    if (!UUID_REGEX.test(body.list_id)) {
      return apiValidationError({ list_id: ["Invalid UUID format"] });
    }
  }

  const supabase = await createServiceClient();

  // If assigning to someone, verify they are a tenant member
  if (body.assigned_to) {
    const { data: member } = await supabase
      .from("tenant_users")
      .select("id, branch_id, positions(slug)")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", body.assigned_to)
      .single();

    if (!member) {
      return apiValidationError({ assigned_to: ["User is not a member of this tenant"] });
    }

    // §4.2: branch manager may only assign to users in their own branch
    if (isTeamScoped && member.branch_id !== auth.branchId) {
      return apiForbidden();
    }

    // Chain check: education chain-position callers (non-admin, non-team-scope) may
    // only assign to their allowed chain targets.
    if (
      auth.industryId === "education_consultancy" &&
      auth.positionSlug != null &&
      ASSIGN_CHAIN_POSITIONS.has(auth.positionSlug) &&
      auth.permissions.baseTier === "member" &&
      !isTeamScoped
    ) {
      const posEmbed = Array.isArray((member as unknown as { positions: unknown }).positions)
        ? ((member as unknown as { positions: Array<{ slug: string }> }).positions[0] ?? null)
        : ((member as unknown as { positions: { slug: string } | null }).positions);
      const targetSlug = (posEmbed as { slug?: string } | null)?.slug ?? null;
      const allowed = new Set(assignableTargetSlugs(auth.positionSlug));
      const okBranch = auth.branchId == null || (member.branch_id ?? null) === auth.branchId;
      if (!targetSlug || !allowed.has(targetSlug) || !okBranch) {
        return apiForbidden();
      }
    }
  }

  // Validate branch_id belongs to tenant if provided
  if (body.branch_id !== undefined && body.branch_id !== null) {
    const { data: branchCheck } = await supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("id", body.branch_id)
      .single();
    if (!branchCheck) {
      return apiValidationError({ branch_id: ["Branch not found in this tenant"] });
    }
    // §4.2: branch manager may only route leads to their own branch
    if (isTeamScoped && body.branch_id !== auth.branchId) {
      return apiForbidden();
    }
  }

  // Validate list_id: feature gate, resolve, check access, require archive_reason
  let targetList: { id: string; slug: string; name: string; is_archive: boolean; access: unknown; pipeline_id: string | null } | null = null;
  if (body.list_id !== undefined && body.list_id !== null) {
    if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) {
      return apiForbidden();
    }
    const { data: listCheck } = await supabase
      .from("lead_lists")
      .select("id, slug, name, is_archive, access, pipeline_id")
      .eq("tenant_id", auth.tenantId)
      .eq("id", body.list_id)
      .maybeSingle();
    if (!listCheck) {
      return apiValidationError({ list_id: ["List not found in this tenant"] });
    }
    // Branch managers (isTeamScoped) can move leads to any stage in their branch
    // per the assignment chain rules — skip position-based list access check for them.
    const accessible = isTeamScoped || canAccessList(
      auth.permissions,
      listCheck.access as { mode: string; positionIds?: string[] },
      auth.positionId,
      listCheck.id,
    );
    if (!accessible) return apiForbidden();
    if (listCheck.is_archive && !body.archive_reason) {
      return apiValidationError({ archive_reason: ["Archive reason is required when moving to an archive list"] });
    }
    targetList = listCheck;
  }

  // Verify all leads exist and belong to tenant (exclude converted leads from bulk operations)
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id, list_id, status")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .is("converted_at", null)
    .in("id", body.ids);

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch leads for bulk update");
    return apiServiceUnavailable("Failed to verify leads");
  }

  const existingMap = new Map(
    (existingLeads ?? []).map((l) => [l.id, { assigned_to: l.assigned_to, branch_id: l.branch_id, list_id: l.list_id as string | null, status: (l as { status: string | null }).status ?? null }])
  );
  const notFoundIds = body.ids.filter((id) => !existingMap.has(id));

  if (notFoundIds.length > 0) {
    log.info({ notFoundIds }, "Some leads not found for bulk update");
  }

  // §4.2: branch manager can only update leads already in their branch
  let idsToUpdate = body.ids.filter((id) => existingMap.has(id));
  if (isTeamScoped) {
    idsToUpdate = idsToUpdate.filter((id) => {
      const lead = existingMap.get(id);
      // Allow leads directly in this branch OR with no branch_id (visible via team member assignment)
      return lead?.branch_id === auth.branchId || lead?.branch_id == null;
    });
  }

  if (idsToUpdate.length === 0) {
    return apiValidationError({ ids: ["No valid leads found to update"] });
  }

  // Prospect-qualification gate (bulk backstop): reject the move if any target lead's
  // academics don't qualify. Returns failing_ids so the caller (funnel-kanban drags one
  // card at a time) can react — e.g. open the fill-in modal for that lead.
  if (
    targetList?.slug === "prospects" &&
    auth.industryId === "education_consultancy" &&
    !canBypassProspectQualification(auth.permissions.baseTier, auth.positionSlug)
  ) {
    const { data: academicRows } = await supabase
      .from("leads")
      .select("id, see_gpa, see_institution, see_passed_year, plus_two_gpa, plus_two_institution, plus_two_passed_year, bachelor_gpa, bachelor_institution, bachelor_passed_year, masters_gpa, masters_institution, masters_passed_year, ielts_score, pte_score, toefl_score, sat_score, gre_gmat_score")
      .eq("tenant_id", auth.tenantId)
      .in("id", idsToUpdate);
    const failingIds = (academicRows ?? [])
      .filter((row) => !hasProspectQualification(row as Record<string, unknown>))
      .map((row) => (row as { id: string }).id);
    if (failingIds.length > 0) {
      return apiValidationError({
        academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."],
        academic_failed_ids: failingIds,
      });
    }
  }

  // Build bulk update payload
  const now = new Date().toISOString();
  const bulkUpdatePayload: Record<string, unknown> = {
    updated_at: now,
    last_activity_at: now,
  };
  if (body.assigned_to !== undefined) bulkUpdatePayload.assigned_to = body.assigned_to ?? null;
  if (body.branch_id !== undefined) bulkUpdatePayload.branch_id = body.branch_id ?? null;
  if (body.list_id !== undefined) {
    bulkUpdatePayload.list_id = body.list_id ?? null;
    if (targetList) {
      bulkUpdatePayload.lead_type = targetList.slug === "prospects" ? "prospect" : "lead";
      if (body.archive_reason) bulkUpdatePayload.archive_reason = body.archive_reason;
      // Archive snapshot: who/when are common to the batch; the per-lead stage(list)
      // + status snapshot is written in a follow-up loop below. Clear on un-archive.
      if (targetList.is_archive) {
        bulkUpdatePayload.archived_by = auth.userId;
        bulkUpdatePayload.archived_at = new Date().toISOString();
      } else {
        bulkUpdatePayload.archived_by = null;
        bulkUpdatePayload.archived_at = null;
        bulkUpdatePayload.archived_from_list_id = null;
        bulkUpdatePayload.archived_from_status = null;
      }
      // Sync pipeline + landing stage so stage updates work after the move.
      // Use the shared helper: default-flagged stage if present, else first by
      // position — a pipeline with no is_default stage (e.g. Prospects) must
      // still land on a real stage, or the lead's Status renders blank.
      if (targetList.pipeline_id) {
        const landing = await getPipelineLandingStage(supabase, targetList.pipeline_id);
        if (landing) {
          bulkUpdatePayload.pipeline_id = targetList.pipeline_id;
          bulkUpdatePayload.stage_id = landing.id;
          bulkUpdatePayload.status = landing.slug;
        }
      }
    }
  }

  // Update all leads
  const { error: updateError } = await supabase
    .from("leads")
    .update(bulkUpdatePayload)
    .eq("tenant_id", auth.tenantId)
    .in("id", idsToUpdate);

  if (updateError) {
    log.error({ err: updateError }, "Failed to bulk update leads");
    return apiServiceUnavailable("Failed to update leads");
  }

  // Per-lead archive snapshot: each lead's prior list (stage) + status differ, so they
  // can't ride the single bulk payload. Written after the move using the pre-move values.
  if (targetList?.is_archive) {
    await Promise.all(
      idsToUpdate.map((id) => {
        const prev = existingMap.get(id);
        return supabase
          .from("leads")
          .update({
            archived_from_list_id: prev?.list_id ?? null,
            archived_from_status: prev?.status ?? null,
          })
          .eq("tenant_id", auth.tenantId)
          .eq("id", id);
      }),
    );
  }

  // Assign display IDs to education leads moving out of staging (best-effort).
  if (body.list_id !== undefined && body.list_id !== null) {
    try {
      await assignDisplayIds({
        supabase,
        tenantId: auth.tenantId,
        industryId: auth.industryId,
        destinationListId: body.list_id,
        leadIds: idsToUpdate,
      });
    } catch (err) {
      log.error({ err }, "assignDisplayIds failed");
    }
  }

  log.info(
    { count: idsToUpdate.length, ids: idsToUpdate, assigned_to: body.assigned_to },
    "Bulk updated leads"
  );

  // Record the new assignee as a collaborator on every updated lead (engaged-user visibility).
  if (body.assigned_to) {
    try {
      await addLeadCollaborators(supabase, auth.tenantId, idsToUpdate, body.assigned_to);
    } catch (err) {
      log.error({ err }, "addLeadCollaborators on bulk assign failed");
    }
  }

  // Previous assignees also retain lifecycle visibility after a bulk handoff.
  // Each lead's prior assignee differs, so group by prev-user and add per group.
  // Mirrors single-lead PATCH behavior (leads/[id]/route.ts).
  if (body.assigned_to !== undefined) {
    const prevByUser = new Map<string, string[]>();
    for (const id of idsToUpdate) {
      const prev = existingMap.get(id)?.assigned_to as string | null | undefined;
      if (prev && prev !== body.assigned_to) {
        const arr = prevByUser.get(prev) ?? [];
        arr.push(id);
        prevByUser.set(prev, arr);
      }
    }
    if (prevByUser.size > 0) {
      try {
        await Promise.all(
          [...prevByUser.entries()].map(([userId, leadIds]) =>
            addLeadCollaborators(supabase, auth.tenantId, leadIds, userId),
          ),
        );
      } catch (err) {
        log.error({ err }, "addLeadCollaborators (prev assignees) on bulk handoff failed");
      }
    }
  }

  // Keep lead_branches origin rows in sync for each updated lead
  if (body.branch_id !== undefined || body.assigned_to !== undefined) {
    await Promise.all(
      idsToUpdate.map((lid) => {
        const existing = existingMap.get(lid);
        const newBranchId = body.branch_id !== undefined ? (body.branch_id ?? null) : (existing?.branch_id ?? null);
        const newAssignedTo = body.assigned_to !== undefined ? (body.assigned_to ?? null) : (existing?.assigned_to ?? null);
        return syncOriginMembership(supabase, auth.tenantId, lid, newBranchId, newAssignedTo);
      })
    );
  }

  // Mirror the new assignee onto every non-origin pool row so the cross-branch pool
  // (unassignedCrossBranchLeadIds) never treats an assigned lead as unclaimed.
  if (body.assigned_to !== undefined) {
    await supabase.from("lead_branches")
      .update({ assigned_to: body.assigned_to ?? null })
      .eq("tenant_id", auth.tenantId)
      .in("lead_id", idsToUpdate)
      .eq("is_origin", false);
  }

  // Resolve old list names for human-readable audit entries
  const oldListNameMap = new Map<string, string>();
  if (body.list_id !== undefined) {
    const uniqueOldListIds = [...new Set(
      idsToUpdate.map((id) => existingMap.get(id)?.list_id).filter((v): v is string => !!v)
    )];
    if (uniqueOldListIds.length > 0) {
      const { data: oldLists } = await supabase
        .from("lead_lists")
        .select("id, name")
        .in("id", uniqueOldListIds);
      if (oldLists) {
        for (const l of oldLists) oldListNameMap.set(l.id, l.name);
      }
    }
  }

  // Create audit logs and events for each updated lead (fire-and-forget)
  Promise.all(
    idsToUpdate.flatMap((id) => {
      const prev = existingMap.get(id);
      const ops: Promise<unknown>[] = [];

      const changes: Record<string, { old: unknown; new: unknown }> = {};
      if (body.assigned_to !== undefined) {
        changes.assigned_to = { old: prev?.assigned_to ?? null, new: body.assigned_to ?? null };
      }
      if (body.branch_id !== undefined) {
        changes.branch_id = { old: prev?.branch_id ?? null, new: body.branch_id ?? null };
      }
      if (body.list_id !== undefined) {
        const oldListId = prev?.list_id ?? null;
        const newListId = body.list_id ?? null;
        if (oldListId !== newListId) {
          // Human-readable names for the activity timeline
          const oldListName = oldListId ? (oldListNameMap.get(oldListId) ?? null) : null;
          const newListName = targetList?.name ?? null;
          changes.list = { old: oldListName, new: newListName };
          if (body.archive_reason) {
            changes.archive_reason = { old: null, new: body.archive_reason };
          }
          ops.push(emitEvent({
            tenantId: auth.tenantId,
            type: body.graduate ? "lead.graduated" : "lead.list_changed",
            entityType: "lead",
            entityId: id,
            payload: {
              old_list_id: oldListId,
              new_list_id: newListId,
              archive_reason: body.archive_reason ?? null,
            },
            requestId,
          }));
        }
      }

      if (Object.keys(changes).length > 0) {
        ops.push(createAuditLog({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: body.graduate ? "lead.graduated" : "lead.updated",
          entityType: "lead",
          entityId: id,
          changes,
          ipAddress: ip,
          userAgent,
          requestId,
        }));
      }

      // Only emit assign/unassign events when assignment is being changed
      if (body.assigned_to !== undefined) {
        ops.push(emitEvent({
          tenantId: auth.tenantId,
          type: body.assigned_to ? "lead.assigned" : "lead.unassigned",
          entityType: "lead",
          entityId: id,
          payload: {
            assigned_to: body.assigned_to ?? null,
            ...(body.branch_id !== undefined && { branch_id: body.branch_id ?? null }),
          },
          requestId,
        }));
      }

      return ops;
    })
  );

  const bulkNotifications = [];

  // Notify new assignee (single notification for bulk, self-suppressed)
  if (body.assigned_to) {
    bulkNotifications.push({
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

  // Notify previous assignees who lost their leads (group by previous assignee, self-suppressed)
  const previousAssignees = new Map<string, number>();
  if (body.assigned_to !== undefined) {
    for (const id of idsToUpdate) {
      const prevAssignee = existingMap.get(id)?.assigned_to;
      if (prevAssignee && prevAssignee !== body.assigned_to) {
        previousAssignees.set(prevAssignee, (previousAssignees.get(prevAssignee) || 0) + 1);
      }
    }
  }

  for (const [prevUserId, count] of previousAssignees) {
    bulkNotifications.push({
      tenantId: auth.tenantId,
      userId: prevUserId,
      type: NotificationTypes.LEAD_UNASSIGNED,
      title: `${count} lead${count !== 1 ? "s" : ""} reassigned`,
      message: `${count} lead${count !== 1 ? "s have" : " has"} been reassigned to someone else`,
      link: "/leads",
    });
  }

  createNotificationsExcept(auth.userId, bulkNotifications);

  return apiSuccess({
    updated: idsToUpdate.length,
    ids: idsToUpdate,
    ...(body.assigned_to !== undefined && { assigned_to: body.assigned_to ?? null }),
    ...(body.branch_id !== undefined && { branch_id: body.branch_id ?? null }),
    ...(body.list_id !== undefined && { list_id: body.list_id ?? null }),
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

  // Verify all leads exist and belong to tenant (exclude converted leads from bulk operations)
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .is("converted_at", null)
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
