import { createServiceClient } from "@/lib/supabase/server";
import { validate, isPhoneForCountry } from "@/lib/api/validation";
import { normalizePhoneForStorage } from "@/lib/phone-utils";
import { requireLeadAccess, resolvePositionSlug, type AuthContext } from "@/lib/api/auth";
import { getLeadMembership, syncOriginMembership } from "@/lib/leads/branch-membership";
import { addLeadCollaborator } from "@/lib/leads/collaborators";
import { canAccessPipeline, canAccessList } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { assignDisplayIds } from "@/lib/leads/assign-display-ids";
import { getPipelineLandingStage } from "@/lib/leads/pipeline-stage";
import { createRequestLogger } from "@/lib/logger";
import {
  createNotificationsExcept,
  getTenantAdminRecipients,
  NotificationTypes,
} from "@/lib/notifications";
import { ASSIGN_CHAIN_POSITIONS, assignableTargetSlugs, peerSlugs } from "@/industries/education-consultancy/lead-assignment-chain";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { sendLeadAssignedEmail } from "@/lib/email/send-lead-assigned";
import { processEmailForwardRules } from "@/lib/email/email-forward";
import {
  coerceAcademicPayload,
  hasProspectQualification,
  canBypassProspectQualification,
} from "@/lib/leads/prospect-qualification";
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
  "see_gpa",
  "see_institution",
  "see_passed_year",
  "plus_two_gpa",
  "plus_two_institution",
  "plus_two_passed_year",
  "bachelor_gpa",
  "bachelor_institution",
  "bachelor_passed_year",
  "masters_gpa",
  "masters_institution",
  "masters_passed_year",
  "ielts_score",
  "pte_score",
  "toefl_score",
  "sat_score",
  "gre_gmat_score",
] as const;

// Blocked for plain counselors/viewers but NOT for team-scoped branch managers
// (who have their own §4.2 guard below).
const ADMIN_ONLY_FIELDS = ["assigned_to", "owner_id", "branch_id"];

export interface ApplyLeadPatchOpts {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export type ApplyLeadPatchOutcome =
  | { kind: "not_found" }
  | { kind: "forbidden"; message?: string }
  | { kind: "validation"; errors: Record<string, string[]> }
  | { kind: "db_error"; error: unknown }
  | {
      kind: "ok";
      lead: Lead;
      changes: Record<string, { old: unknown; new: unknown }>;
      /** Pre-substitution old values (raw list_id, not name) of every updated column — undo snapshot source. */
      previousValues: Record<string, unknown>;
    };

/**
 * The core of `PATCH /api/v1/leads/[id]` (previously inline in the route),
 * extracted so AI write tools (update_lead_stage, assign_lead,
 * undo_lead_action — Phase 4B) can call the exact same governance/side-effect
 * pipeline instead of reimplementing it. Kept behavior-identical to the
 * pre-extraction route — see route.test.ts for the REST-parity gate.
 *
 * Deliberately still uses createServiceClient() + manual .eq("tenant_id", ...)
 * filters (not scopedClient) — this file is on the legacy migration list;
 * converting ~30 queries to scopedClient in the same diff as the extraction
 * would make regressions undiagnosable. See BRIEF-PHASE-4B-LEAD-WRITES.md §1.
 */
export async function applyLeadPatch(
  auth: AuthContext,
  leadId: string,
  rawBody: Record<string, unknown>,
  opts: ApplyLeadPatchOpts,
): Promise<ApplyLeadPatchOutcome> {
  const { requestId, ip, userAgent } = opts;
  const body: Record<string, unknown> = { ...rawBody };

  // Country-aware phone format check — education_consultancy only, format-only
  // (a patch clearing/omitting phone is still allowed; this only rejects an
  // invalid non-empty value).
  if (auth.industryId === "education_consultancy") {
    const { valid: validPhone, errors: phoneErrors } = validate(body, {
      phone: [isPhoneForCountry()],
    });
    if (!validPhone) return { kind: "validation", errors: phoneErrors };
  }

  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/${leadId}`,
    ip: ip ?? undefined,
  });

  const supabase = await createServiceClient();

  // Owner/admin + branch managers skip the Prospects academic-qualification
  // requirement: for them qualification reads as satisfied at the hard gate,
  // the assign-counselor hard-block, and the auto-promote below.
  //
  // Ported from PRs #235/#236, which added this to the PATCH route BEFORE
  // Phase 4B extracted that route's body into this file. The extraction was
  // made from the pre-bypass version, so rebasing onto stage silently dropped
  // it here — this file is new on the Phase 4 branch, so git merged it clean
  // while the only conflict appeared in the route it was extracted from. Every
  // sibling path (leads/route.ts, bulk, check-in, the UI pages) kept the
  // bypass; without this, an admin could promote via bulk but not via the lead
  // detail page — exactly the "remaining client flows" gap #236 closed.
  const bypassQual = canBypassProspectQualification(auth.permissions.baseTier, auth.positionSlug);

  // Fetch existing lead for audit diff + access check
  const { data: existingLead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    log.info({ leadId }, "Lead not found for update");
    return { kind: "not_found" };
  }

  // Pipeline-access enforcement (dormant until Phase 3)
  if (!canAccessPipeline(auth.permissions, existingLead.pipeline_id)) return { kind: "forbidden" };

  // Access check: admin or counselor with assignment
  const patchMembership = await getLeadMembership(supabase, auth.tenantId, leadId);

  // Narrow exception: own-scope education chain member who checked in this unassigned lead
  // may assign it (e.g. lead-executive assigning a counselor to a walk-in they checked in).
  let isSelfCheckInAssign = false;
  if (
    auth.industryId === "education_consultancy" &&
    auth.positionSlug != null &&
    ASSIGN_CHAIN_POSITIONS.has(auth.positionSlug) &&
    auth.permissions.leadScope === "own" &&
    auth.permissions.canAssignLeads &&
    existingLead.assigned_to == null &&
    Object.keys(body).length === 1 &&
    body.assigned_to !== undefined
  ) {
    const { count } = await supabase
      .from("lead_notes")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("user_id", auth.userId)
      .like("content", "[CHECK-IN]%");
    isSelfCheckInAssign = (count ?? 0) > 0;
  }

  // Narrow exception: own-scope chain member may assign an unassigned cross-branch lead
  // shared into their branch when the lead's list matches their position route.
  let isCrossBranchPooledAssign = false;
  if (
    !isSelfCheckInAssign &&
    auth.industryId === "education_consultancy" &&
    auth.positionSlug != null &&
    ASSIGN_CHAIN_POSITIONS.has(auth.positionSlug) &&
    auth.permissions.leadScope === "own" &&
    auth.permissions.canAssignLeads &&
    existingLead.assigned_to == null &&
    Object.keys(body).length === 1 &&
    body.assigned_to !== undefined
  ) {
    // Only sent-in (is_origin=false) shared rows qualify — never the branch's own origin lead.
    const inBranchUnassigned = !!auth.branchId && patchMembership.some(
      (m) => m.branch_id === auth.branchId && m.assigned_to === null && !m.is_origin,
    );
    if (inBranchUnassigned) {
      const routeSlug = POSITION_ROUTE_MAP[auth.positionSlug];
      if (routeSlug && (existingLead as Record<string, unknown>).list_id) {
        const { data: listRow } = await supabase
          .from("lead_lists").select("slug")
          .eq("id", (existingLead as Record<string, unknown>).list_id as string)
          .eq("tenant_id", auth.tenantId)
          .maybeSingle();
        isCrossBranchPooledAssign = (listRow as { slug?: string } | null)?.slug === routeSlug;
      }
    }
  }

  if (!isSelfCheckInAssign && !isCrossBranchPooledAssign && !requireLeadAccess(auth, existingLead, patchMembership)) {
    return { kind: "forbidden" };
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
        return { kind: "forbidden" };
      }
    }
  }

  // Validate an incoming pipeline_id belongs to this tenant before it can be
  // written (pipeline_id is in UPDATABLE_FIELDS, and the drift self-heal sends it).
  // Stops a crafted request from stamping a lead with another tenant's pipeline.
  // Scoped to education_consultancy so non-education tenants keep prior behavior.
  if (
    auth.industryId === "education_consultancy" &&
    body.pipeline_id !== undefined &&
    body.pipeline_id !== null
  ) {
    const { data: pipelineCheck } = await supabase
      .from("pipelines")
      .select("id")
      .eq("id", body.pipeline_id as string)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();
    if (!pipelineCheck) {
      return { kind: "validation", errors: { pipeline_id: ["Pipeline not found in this tenant"] } };
    }
  }

  // Dual-mode status/stage_id resolution
  if (body.status !== undefined && body.stage_id !== undefined) {
    return {
      kind: "validation",
      errors: { status: ["Cannot provide both status and stage_id. Use one or the other."] },
    };
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
      return {
        kind: "validation",
        errors: { status: [`Invalid status: "${body.status}". No matching pipeline stage found.`] },
      };
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

    // Scope validation to the target pipeline. For education, prefer an incoming
    // pipeline_id (the KeyInfoSection data-drift fallback sends stage_id + pipeline_id
    // together to re-sync a mismatched lead). Non-education tenants keep prior behavior
    // (validate against the lead's current pipeline only) so nothing changes for them.
    const currentPipelineId = (existingLead as Record<string, unknown>).pipeline_id as string | null;
    const targetPipelineId =
      auth.industryId === "education_consultancy"
        ? ((body.pipeline_id as string | undefined) ?? currentPipelineId)
        : currentPipelineId;
    if (targetPipelineId) {
      stageQuery = stageQuery.eq("pipeline_id", targetPipelineId);
    }

    const { data: stage } = await stageQuery.single();

    if (!stage) {
      return {
        kind: "validation",
        errors: { stage_id: ["Invalid stage_id. Stage does not belong to this lead's pipeline."] },
      };
    }

    body.status = stage.slug;
  }

  // ── Stage-transition governance: detect a backward (revert) list move up front ──
  // so the assignee check below applies revert rules (previous holder's team) instead
  // of the forward chain check, and so the revert is not logged as a new handoff.
  let isRevert = false;
  let revertPrevHolderId: string | null = null;
  {
    const targetListId = typeof body.list_id === "string" ? body.list_id : null;
    const curListId = (existingLead as Record<string, unknown>).list_id as string | null;
    if (auth.industryId === "education_consultancy" && targetListId && targetListId !== curListId) {
      const { data: targetL } = await supabase
        .from("lead_lists").select("sort_order, is_archive").eq("id", targetListId).maybeSingle();
      let curSort: number | null = null;
      if (curListId) {
        const { data: curL } = await supabase
          .from("lead_lists").select("sort_order, is_archive").eq("id", curListId).maybeSingle();
        curSort = curL && !curL.is_archive ? curL.sort_order : null;
      }
      if (targetL && !targetL.is_archive && curSort !== null && targetL.sort_order < curSort) {
        isRevert = true;
        const currentHolder = existingLead.assigned_to as string | null;
        if (currentHolder) {
          const { data: lh } = await supabase
            .from("lead_assignment_history").select("from_user_id")
            .eq("lead_id", leadId).eq("to_user_id", currentHolder)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          revertPrevHolderId = (lh as { from_user_id?: string } | null)?.from_user_id ?? null;
        }
      }
    }
  }

  // Validate assigned_to: must be a tenant member
  let newAssigneeBranchId: string | null | undefined = undefined;
  if (body.assigned_to !== undefined && body.assigned_to !== null) {
    const { data: memberCheck } = await supabase
      .from("tenant_users")
      .select("user_id, branch_id, role, positions(slug)")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", body.assigned_to as string)
      .single();

    if (!memberCheck) {
      return { kind: "validation", errors: { assigned_to: ["Assigned user is not a member of this tenant"] } };
    }

    newAssigneeBranchId = (memberCheck as unknown as { branch_id: string | null }).branch_id ?? null;

    // Target's position slug (fall back to role) + branch — used by both the forward
    // chain check and the revert-peer check.
    const posEmbed = Array.isArray((memberCheck as unknown as { positions: unknown }).positions)
      ? ((memberCheck as unknown as { positions: Array<{ slug: string }> }).positions[0] ?? null)
      : ((memberCheck as unknown as { positions: { slug: string } | null }).positions);
    const targetSlug = (posEmbed as { slug?: string } | null)?.slug ?? null;
    const targetRole = (memberCheck as unknown as { role?: string }).role ?? null;
    const effectiveSlug = targetSlug ?? targetRole;
    const targetBranchId = (memberCheck as unknown as { branch_id?: string | null }).branch_id ?? null;

    const isChainCaller =
      auth.industryId === "education_consultancy" &&
      auth.positionSlug != null &&
      ASSIGN_CHAIN_POSITIONS.has(auth.positionSlug) &&
      auth.permissions.baseTier === "member" &&
      auth.permissions.leadScope !== "team";

    // Admins are always a valid assignment target (education_consultancy only) —
    // bypasses the chain/branch restrictions below, forward or revert.
    const isAdminTarget = auth.industryId === "education_consultancy" && targetRole === "admin";

    if (isChainCaller && isRevert) {
      // Revert: the assignee must be the previous holder or a same-position peer in
      // their branch — or an admin. First-holder (no prior handoff) may not revert.
      if (!revertPrevHolderId) {
        return { kind: "forbidden", message: "First holder cannot revert this lead" };
      }
      const { data: prevHolder } = await supabase
        .from("tenant_users")
        .select("branch_id, role, positions(slug)")
        .eq("tenant_id", auth.tenantId)
        .eq("user_id", revertPrevHolderId)
        .single();
      const prevEmbed = Array.isArray((prevHolder as unknown as { positions: unknown } | null)?.positions)
        ? ((prevHolder as unknown as { positions: Array<{ slug: string }> }).positions[0] ?? null)
        : ((prevHolder as unknown as { positions: { slug: string } | null } | null)?.positions ?? null);
      const prevSlug = (prevEmbed as { slug?: string } | null)?.slug
        ?? (prevHolder as unknown as { role?: string } | null)?.role ?? null;
      const prevBranchId = (prevHolder as unknown as { branch_id?: string | null } | null)?.branch_id ?? null;
      const okPeer =
        effectiveSlug != null &&
        effectiveSlug === prevSlug &&
        (prevBranchId == null || targetBranchId === prevBranchId);
      if (!okPeer && !isAdminTarget) {
        return { kind: "forbidden" };
      }
    } else if (isChainCaller) {
      // Forward chain check: education chain-position callers may only assign to their
      // allowed chain targets — or an admin.
      // Cross-branch pool grab: restrict to self + same-position peers (no forward-to-next hop).
      // Normal own-scope assign keeps the full chain targets (peer + next position).
      const allowed = new Set(
        isCrossBranchPooledAssign ? peerSlugs(auth.positionSlug) : assignableTargetSlugs(auth.positionSlug),
      );
      const okBranch = auth.branchId == null || targetBranchId === auth.branchId;
      if (!isAdminTarget && (!effectiveSlug || !allowed.has(effectiveSlug) || !okBranch)) {
        return { kind: "forbidden" };
      }
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
      return { kind: "validation", errors: { owner_id: ["Owner is not a member of this tenant"] } };
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
      return { kind: "validation", errors: { entity_id: ["Entity not found in this tenant"] } };
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
      return { kind: "validation", errors: { branch_id: ["Branch not found in this tenant"] } };
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
        return { kind: "forbidden" };
      }
      if (body.assigned_to !== undefined && body.assigned_to !== null) {
        const { data: targetMember } = await supabase
          .from("tenant_users")
          .select("branch_id, role")
          .eq("tenant_id", auth.tenantId)
          .eq("user_id", body.assigned_to as string)
          .single();
        // Admins are always a valid target, regardless of branch (education_consultancy only).
        const isAdminTarget = auth.industryId === "education_consultancy" && targetMember?.role === "admin";
        if (!targetMember || (targetMember.branch_id !== auth.branchId && !isAdminTarget)) {
          return { kind: "forbidden" };
        }
      }
      // Branch manager may only set branch_id to their own branch (or clear it)
      if (body.branch_id !== undefined && body.branch_id !== null && body.branch_id !== auth.branchId) {
        return { kind: "forbidden" };
      }
    }
  }

  // Validate list_id: must belong to this tenant and be accessible to the caller
  if (body.list_id !== undefined && body.list_id !== null) {
    if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) {
      return { kind: "forbidden" };
    }
    const { data: listCheck } = await supabase
      .from("lead_lists")
      .select("id, slug, is_archive, access")
      .eq("tenant_id", auth.tenantId)
      .eq("id", body.list_id as string)
      .maybeSingle();
    if (!listCheck) {
      return { kind: "validation", errors: { list_id: ["List not found in this tenant"] } };
    }
    const accessible = canAccessList(
      auth.permissions,
      listCheck.access as { mode: string; positionIds?: string[] },
      auth.positionId,
      listCheck.id,
    );
    if (!accessible) return { kind: "forbidden" };
  }

  // Build update payload from whitelist
  const updatePayload: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) {
      updatePayload[field] = body[field];
    }
  }
  if (typeof updatePayload.phone === "string") {
    updatePayload.phone = normalizePhoneForStorage(updatePayload.phone as string);
  }
  Object.assign(updatePayload, coerceAcademicPayload(body));

  // Mirror lead_type on list move (keeps existing education UI working during transition)
  // Also resolve list names for the audit log so the activity timeline can render them.
  let newListName: string | null = null;
  let oldListName: string | null = null;
  // isRevert declared earlier (backward-move detection for the assignee check); the
  // block below still handles the no-explicit-assignee fallback (auto-resolve + origin guard).
  if (updatePayload.list_id !== undefined && updatePayload.list_id !== null) {
    const { data: targetList } = await supabase
      .from("lead_lists")
      .select("id, slug, name, pipeline_id, is_archive, sort_order")
      .eq("id", updatePayload.list_id as string)
      .maybeSingle();
    if (targetList) {
      updatePayload.lead_type = targetList.slug === "prospects" ? "prospect" : "lead";
      newListName = targetList.name;

      // Prospect-qualification gate (server backstop): current lead's academic columns
      // merged with anything incoming in this same PATCH must satisfy the gate.
      if (
        targetList.slug === "prospects" &&
        auth.industryId === "education_consultancy" &&
        !bypassQual
      ) {
        const merged = { ...(existingLead as Record<string, unknown>), ...updatePayload };
        if (!hasProspectQualification(merged)) {
          return {
            kind: "validation",
            errors: { academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."] },
          };
        }
      }

      // Stage-transition governance: on a backward (revert) move in the education funnel,
      // reassign to the previous stage's holder instead of leaving assigned_to untouched.
      // Only fires when the caller didn't pass an explicit assigned_to (send-to-next always does).
      if (
        auth.industryId === "education_consultancy" &&
        !targetList.is_archive &&
        body.assigned_to === undefined
      ) {
        const currentListId = (existingLead as Record<string, unknown>).list_id as string | null;
        let currentSortOrder: number | null = null;
        if (currentListId) {
          const { data: currentList } = await supabase
            .from("lead_lists")
            .select("sort_order, is_archive")
            .eq("id", currentListId)
            .maybeSingle();
          currentSortOrder = currentList && !currentList.is_archive ? currentList.sort_order : null;
        }
        if (currentSortOrder !== null && targetList.sort_order < currentSortOrder) {
          isRevert = true;
          const isExempt =
            auth.permissions.baseTier !== "member" || auth.permissions.leadScope === "team";
          const currentHolder = existingLead.assigned_to as string | null;
          let lastHandoffFromUserId: string | null = null;
          if (currentHolder) {
            const { data: lastHandoff } = await supabase
              .from("lead_assignment_history")
              .select("from_user_id")
              .eq("lead_id", leadId)
              .eq("to_user_id", currentHolder)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            lastHandoffFromUserId = (lastHandoff as { from_user_id?: string } | null)?.from_user_id ?? null;
          }
          if (lastHandoffFromUserId) {
            updatePayload.assigned_to = lastHandoffFromUserId;
          } else if (!isExempt) {
            // No prior handoff recorded → this holder is the lead's origin.
            return { kind: "forbidden", message: "First holder cannot revert this lead" };
          }
          // Exempt origin caller: allow the move, leave assigned_to as-is.
        }
      }

      // Archive snapshot: capture stage(list) + status + who/when at archive time,
      // BEFORE the block below clears live stage_id/status. Clear on un-archive.
      const wasArchived = !!(existingLead as Record<string, unknown>).archived_at;
      if (targetList.is_archive) {
        updatePayload.archived_by = auth.userId;
        updatePayload.archived_at = new Date().toISOString();
        updatePayload.archived_from_list_id = (existingLead as Record<string, unknown>).list_id ?? null;
        updatePayload.archived_from_status = (existingLead as Record<string, unknown>).status ?? null;
      } else if (wasArchived) {
        updatePayload.archived_by = null;
        updatePayload.archived_at = null;
        updatePayload.archived_from_list_id = null;
        updatePayload.archived_from_status = null;
      }
      // Reset stage to the destination list's landing stage on list move — UNLESS the
      // caller explicitly set status/stage_id in this same request (they win, and the
      // dual-mode block above already resolved them; don't double-write).
      // If destination has no pipeline, clear stage so it doesn't show stale/null as "Unknown".
      const callerSetStage = body.status !== undefined || body.stage_id !== undefined;
      if (targetList.pipeline_id) {
        if (!callerSetStage) {
          const landing = await getPipelineLandingStage(supabase, targetList.pipeline_id);
          if (landing) {
            updatePayload.pipeline_id = targetList.pipeline_id;
            updatePayload.stage_id = landing.id;
            updatePayload.status = landing.slug;
          }
        }
      } else {
        updatePayload.pipeline_id = null;
        updatePayload.stage_id = null;
        updatePayload.status = null;
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

  // Cross-branch reassignment: reset status to the current list's default stage.
  // When a lead moves to a new team the new member starts from first status,
  // not inheriting mid-stream progress from the previous team.
  // Only fires when: assignee actually changes to a different user, new assignee is in a
  // genuinely different branch than the PREVIOUS assignee (not the lead's origin branch),
  // no list_id change is already in the payload (list moves handle it above),
  // and the caller did NOT explicitly set status or stage_id.
  if (
    body.assigned_to !== undefined &&
    body.assigned_to !== null &&
    (body.assigned_to as string) !== (existingLead.assigned_to as string | null) &&
    newAssigneeBranchId !== undefined &&
    updatePayload.list_id === undefined &&
    body.status === undefined &&
    body.stage_id === undefined
  ) {
    const currentListId = (existingLead as Record<string, unknown>).list_id as string | null;
    if (currentListId) {
      // Fetch previous assignee's branch to detect actual cross-branch move
      let prevAssigneeBranchId: string | null = null;
      const prevAssigneeId = existingLead.assigned_to as string | null;
      if (prevAssigneeId) {
        const { data: prevMember } = await supabase
          .from("tenant_users")
          .select("branch_id")
          .eq("tenant_id", auth.tenantId)
          .eq("user_id", prevAssigneeId)
          .maybeSingle();
        prevAssigneeBranchId = (prevMember as { branch_id: string | null } | null)?.branch_id ?? null;
      }
      // Only reset if new assignee is in a genuinely different branch
      if (newAssigneeBranchId !== prevAssigneeBranchId) {
        const { data: crossBranchList } = await supabase
          .from("lead_lists")
          .select("pipeline_id")
          .eq("id", currentListId)
          .maybeSingle();
        if (crossBranchList?.pipeline_id) {
          const landing = await getPipelineLandingStage(supabase, crossBranchList.pipeline_id);
          if (landing) {
            updatePayload.pipeline_id = crossBranchList.pipeline_id;
            updatePayload.stage_id = landing.id;
            updatePayload.status = landing.slug;
          }
        }
      }
    }
  }

  // Pre-Application fee normalization (migration 084)
  if (updatePayload.pre_app_fee_status !== undefined) {
    const fs = updatePayload.pre_app_fee_status;
    if (fs !== null && !["paid", "unpaid", "waiver"].includes(fs as string)) {
      return { kind: "validation", errors: { pre_app_fee_status: ["Must be one of: paid, unpaid, waiver"] } };
    }
    // Amount only makes sense when paid — drop it otherwise to keep data clean.
    if (fs !== "paid") updatePayload.pre_app_fee_amount = null;
  }
  if (updatePayload.pre_app_fee_amount !== undefined && updatePayload.pre_app_fee_amount !== null) {
    const amt = Number(updatePayload.pre_app_fee_amount);
    updatePayload.pre_app_fee_amount = Number.isFinite(amt) && amt >= 0 ? amt : null;
  }

  if (Object.keys(updatePayload).length === 0) {
    return { kind: "validation", errors: { body: ["No valid fields to update"] } };
  }

  // Hard-block: assigning a counselor that would auto-promote an unqualified lead into
  // Prospects. Must run BEFORE the update below — the auto-promote block further down
  // fires only after the lead is already saved, too late to block.
  if (
    auth.industryId === "education_consultancy" &&
    updatePayload.assigned_to != null &&
    updatePayload.list_id === undefined
  ) {
    const slug = await resolvePositionSlug(supabase, auth.tenantId, updatePayload.assigned_to as string);
    if (slug === "counselor") {
      const { data: prospectsList } = await supabase.from("lead_lists")
        .select("id, sort_order").eq("tenant_id", auth.tenantId).eq("slug", "prospects").maybeSingle();
      if (prospectsList) {
        const currentListId = (existingLead as Record<string, unknown>).list_id as string | null;
        let sort: number | null = null, staging = false;
        if (currentListId) {
          const { data: cl } = await supabase.from("lead_lists")
            .select("sort_order, is_staging").eq("id", currentListId).maybeSingle();
          sort = cl?.sort_order ?? null; staging = cl?.is_staging ?? false;
        }
        const wouldPromote = sort === null || staging || sort < prospectsList.sort_order;
        const qualifies = hasProspectQualification({ ...(existingLead as Record<string, unknown>), ...updatePayload });
        if (wouldPromote && !qualifies && !bypassQual) {
          return { kind: "validation", errors: { academic: ["Add the student's highest qualification (%/GPA) before assigning a counselor."] } };
        }
      }
    }
  }

  const { data: updated, error } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", leadId)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update lead");
    return { kind: "db_error", error };
  }

  // Keep lead_branches origin row in sync with leads.branch_id / leads.assigned_to
  if (updatePayload.branch_id !== undefined || updatePayload.assigned_to !== undefined) {
    await syncOriginMembership(supabase, auth.tenantId, leadId, (updated as Lead).branch_id ?? null, (updated as Lead).assigned_to ?? null);
  }
  // Mirror leads.assigned_to onto every non-origin pool row for this lead — prevents the
  // cross-branch pool from showing an already-claimed lead to other callers, and reopens
  // the pool row on unassign. Runs for every assigner (incl. admin/owner with no branchId)
  // and covers all pool rows, not just the caller's own branch.
  if (updatePayload.assigned_to !== undefined) {
    await supabase.from("lead_branches")
      .update({ assigned_to: (updated as Lead).assigned_to ?? null })
      .eq("tenant_id", auth.tenantId)
      .eq("lead_id", leadId)
      .eq("is_origin", false);
  }

  // New assignee becomes a permanent collaborator (engaged-user visibility).
  if (updatePayload.assigned_to !== undefined && (updated as Lead).assigned_to) {
    try {
      await addLeadCollaborator(supabase, auth.tenantId, leadId, (updated as Lead).assigned_to);
    } catch (err) {
      log.error({ err }, "addLeadCollaborator on assign failed");
    }
  }

  // Previous assignee also retains lifecycle visibility after handoff.
  const prevAssigneeId = existingLead.assigned_to as string | null;
  if (updatePayload.assigned_to !== undefined && prevAssigneeId && prevAssigneeId !== ((updated as Lead).assigned_to ?? null)) {
    try {
      await addLeadCollaborator(supabase, auth.tenantId, leadId, prevAssigneeId);
    } catch (err) {
      log.error({ err }, "addLeadCollaborator (prev assignee) on handoff failed");
    }
  }

  // Two-step check-in assign: the lead-exec who did the initial walk-in retains lifecycle
  // visibility after handing the lead off to a counselor.
  if (isSelfCheckInAssign) {
    try {
      await addLeadCollaborator(supabase, auth.tenantId, leadId, auth.userId);
    } catch (err) {
      log.error({ err }, "addLeadCollaborator (checker) on self check-in assign failed");
    }
  }

  // Auto-promote to Prospects when assigned_to changes to a counselor and the lead
  // is in a pre-Prospects stage (mirrors check-in route promotion logic).
  // Best-effort: failure must not fail the PATCH response.
  if (
    auth.industryId === "education_consultancy" &&
    updatePayload.assigned_to !== undefined &&
    updatePayload.assigned_to !== null &&
    updatePayload.list_id === undefined // don't double-move if list is already being set
  ) {
    try {
      const newAssigneeSlug = await resolvePositionSlug(supabase, auth.tenantId, updatePayload.assigned_to as string);
      if (newAssigneeSlug === "counselor") {
        const { data: prospectsList } = await supabase
          .from("lead_lists")
          .select("id, sort_order, pipeline_id")
          .eq("tenant_id", auth.tenantId)
          .eq("slug", "prospects")
          .maybeSingle();
        if (prospectsList) {
          const currentListId = (existingLead as Record<string, unknown>).list_id as string | null;
          let currentSortOrder: number | null = null;
          let currentIsStaging = false;
          if (currentListId) {
            const { data: currentList } = await supabase
              .from("lead_lists")
              .select("sort_order, is_staging")
              .eq("id", currentListId)
              .maybeSingle();
            currentSortOrder = currentList?.sort_order ?? null;
            currentIsStaging = currentList?.is_staging ?? false;
          }
          const qualifies = hasProspectQualification({
            ...(existingLead as Record<string, unknown>),
            ...updatePayload,
          });
          if (
            (qualifies || bypassQual) &&
            (currentSortOrder === null || currentIsStaging || currentSortOrder < prospectsList.sort_order)
          ) {
            const promotePayload: Record<string, unknown> = {
              list_id: prospectsList.id,
              lead_type: "prospect",
              updated_at: new Date().toISOString(),
            };
            if (prospectsList.pipeline_id) {
              const { data: defaultStage } = await supabase
                .from("pipeline_stages")
                .select("id, slug")
                .eq("pipeline_id", prospectsList.pipeline_id)
                .eq("is_default", true)
                .maybeSingle();
              if (defaultStage) {
                promotePayload.pipeline_id = prospectsList.pipeline_id;
                promotePayload.stage_id = defaultStage.id;
                promotePayload.status = defaultStage.slug;
              }
            }
            await supabase
              .from("leads")
              .update(promotePayload)
              .eq("id", leadId)
              .eq("tenant_id", auth.tenantId);
          }
        }
      }
    } catch (err) {
      log.error({ err }, "Auto-promote to Prospects on counselor assign failed");
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
        leadIds: [leadId],
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

  // Pre-substitution snapshot of every updated column's old value — the undo
  // source of truth (raw list_id, not the name-substituted version below).
  const previousValues: Record<string, unknown> = {};
  for (const field of Object.keys(changes)) {
    previousValues[field] = changes[field].old;
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

  log.info({ leadId, changes }, "Lead updated");

  const statusChanged = updated.status !== existingLead.status;
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
          entityId: leadId,
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
            entityId: leadId,
            payload: {
              old_status: existingLead.status,
              new_status: updated.status,
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
            entityId: leadId,
            payload: {
              old_assigned_to: existingLead.assigned_to,
              new_assigned_to: updated.assigned_to,
            },
            requestId,
          }),
        ]
      : []),
    // Lead assignment history: only true user→user handoffs (both ends non-null),
    // snapshotting each user's position at the moment of the handoff. Revert-reassign
    // is excluded — it's a bounce-back to a known prior holder, not a new handoff, and
    // recording it here would let the reverted-to user "revert" again (breaking §4).
    ...(assignedChanged && existingLead.assigned_to && updated.assigned_to && !isRevert
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
              lead_id: leadId,
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
            entityId: leadId,
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
        link: `/leads/${leadId}`,
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
              leadId,
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
        link: `/leads/${leadId}`,
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
        link: `/leads/${leadId}`,
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
          link: `/leads/${leadId}`,
        });
      }
    }

    createNotificationsExcept(auth.userId, stageNotifications);
  }

  return { kind: "ok", lead: updated as Lead, changes, previousValues };
}
