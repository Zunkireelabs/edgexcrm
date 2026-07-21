import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPipelineLandingStage } from "@/lib/leads/pipeline-stage";
import { authenticateRequest, resolvePositionSlug } from "@/lib/api/auth";
import { logger } from "@/lib/logger";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
  apiValidationError,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { hasProspectQualification, canBypassProspectQualification } from "@/lib/leads/prospect-qualification";
import { addLeadCollaborator } from "@/lib/leads/collaborators";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/v1/leads/:id/check-in — log a check-in visit note
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant.
  // No ownership/branch check — check-in is a front-desk action; any authenticated
  // user with check-in access can log a visit for any lead in the tenant.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, list_id, assigned_to, tags, archived_at, deleted_at, see_gpa, see_institution, see_passed_year, plus_two_gpa, plus_two_institution, plus_two_passed_year, bachelor_gpa, bachelor_institution, bachelor_passed_year, masters_gpa, masters_institution, masters_passed_year, ielts_score, pte_score, toefl_score, sat_score, gre_gmat_score")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  let reason = "";
  let meetWithId: string | null = null;
  let assignToId: string | null = null;
  let moveToStage: "qualified" | "prospects" | null = null;
  try {
    const body = await request.json();
    reason = (body.reason as string) || "";
    // Per-visit "meet with" person, stored on THIS check-in note — distinct from
    // lead.assigned_to (the counselor). Optional.
    meetWithId = (body.meet_with_id as string) || null;
    // Explicit front-desk triage (education only): owning counselor + optional stage move.
    assignToId = (body.assign_to_id as string) || null;
    const mv = body.move_to_stage as string | undefined;
    moveToStage = mv === "qualified" || mv === "prospects" ? mv : null;
  } catch {
    // No body is fine
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const content = reason
    ? `[CHECK-IN] Visited on ${dateStr} at ${timeStr} — ${reason}`
    : `[CHECK-IN] Visited on ${dateStr} at ${timeStr}`;

  const { error } = await supabase.from("lead_notes").insert({
    lead_id: id,
    user_id: auth.userId,
    user_email: auth.email || "unknown",
    content,
    meet_with_id: meetWithId,
  });

  if (error) {
    return apiServiceUnavailable("Failed to log check-in");
  }

  const isEducation = auth.industryId === "education_consultancy";

  // Current stage slug (source of truth for triage decisions).
  let currentSlug: string | null = null;
  if (lead.list_id) {
    const { data: cur } = await supabase
      .from("lead_lists")
      .select("slug")
      .eq("id", lead.list_id)
      .maybeSingle();
    currentSlug = cur?.slug ?? null;
  }

  // An explicit triage decision is present when the front desk asked to move the lead,
  // OR the lead is already in Qualified (where a blank picker means "assign the checker").
  const explicitTriage =
    isEducation && (moveToStage !== null || currentSlug === "qualified");

  let newAssigned: string | null = null;
  if (explicitTriage) {
    try {
      const targetSlug = moveToStage; // null = stay in current (qualified in-place)

      // Assignment rule:
      //   qualified target/in-place → picked, else keep existing, else the checker.
      //   prospects target          → picked, else keep existing (no checker fallback).
      const effectiveTargetIsQualified =
        targetSlug === "qualified" || (targetSlug === null && currentSlug === "qualified");
      if (assignToId) {
        newAssigned = assignToId;
      } else if (lead.assigned_to) {
        newAssigned = lead.assigned_to; // never overwrite an existing owner with blank
      } else {
        newAssigned = effectiveTargetIsQualified ? auth.userId : null;
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (newAssigned !== lead.assigned_to) updatePayload.assigned_to = newAssigned;

      if (targetSlug) {
        const { data: target } = await supabase
          .from("lead_lists")
          .select("id, pipeline_id")
          .eq("tenant_id", auth.tenantId)
          .eq("slug", targetSlug)
          .maybeSingle();
        if (target) {
          updatePayload.list_id = target.id;
          if (targetSlug === "prospects") updatePayload.lead_type = "prospect";
          if (target.pipeline_id) {
            const landing = await getPipelineLandingStage(supabase, target.pipeline_id);
            if (landing) {
              updatePayload.pipeline_id = target.pipeline_id;
              updatePayload.stage_id = landing.id;
              updatePayload.status = landing.slug;
            }
          }
          // Un-archive (mirror the auto-promotion path).
          if (lead.archived_at) {
            updatePayload.archived_at = null;
            updatePayload.archived_by = null;
            updatePayload.archived_from_list_id = null;
            updatePayload.archived_from_status = null;
          }
        }
      }

      // Only write if something actually changed beyond updated_at.
      if (Object.keys(updatePayload).length > 1) {
        const { error: triageError } = await supabase
          .from("leads")
          .update(updatePayload)
          .eq("id", id)
          .eq("tenant_id", auth.tenantId);
        if (triageError) {
          logger.error({ err: triageError, leadId: id }, "Failed to apply check-in triage");
        }
      }
    } catch (triageErr) {
      logger.error({ err: triageErr, leadId: id }, "Unexpected error applying check-in triage");
    }

    // Collaborator parity with applyLeadPatch (deferred in the design spec, now enabled):
    // the checker retains lifecycle visibility of a lead they walked in, and the assigned
    // counselor keeps view access across any future reassign. Best-effort — a failure here
    // must never fail the check-in (the note + assignment already succeeded). Idempotent upsert.
    try {
      await addLeadCollaborator(supabase, auth.tenantId, id, auth.userId);
      if (newAssigned) {
        await addLeadCollaborator(supabase, auth.tenantId, id, newAssigned);
      }
    } catch (collabErr) {
      logger.error({ err: collabErr, leadId: id }, "Failed to sync check-in collaborators");
    }

    return apiSuccess({ checked_in: true, lead_id: id });
  }

  // Auto-promotion (education_consultancy, student check-ins only) — forward-only:
  //   1) Counselor assigned  → Prospects (any performer), subject to the academic gate.
  //   2) No counselor + an elevated performer (lead-exec/admin/owner) → Qualified,
  //      self-assigning the lead-exec as interim counselor if still unassigned.
  // A lead already at/past its target stage (slug-based, not sort_order) is left alone.
  // Non-student / non-education / no-counselor-with-non-elevated-performer → no move.
  // Best-effort: a failure here must not fail the check-in itself (note already logged).
  let assignedIsCounselor = false;
  if (lead.assigned_to) {
    const assignedPositionSlug = await resolvePositionSlug(supabase, auth.tenantId, lead.assigned_to);
    assignedIsCounselor = assignedPositionSlug === "counselor";
  }

  const isStudent = ((lead.tags as string[] | null) ?? []).includes("student");
  const performerElevated =
    auth.positionSlug === "lead-executive" ||
    auth.permissions.baseTier === "admin" ||
    auth.permissions.baseTier === "owner";

  try {
    if (isEducation && isStudent && !lead.deleted_at) {
      const ADVANCED = new Set(["qualified", "prospects", "applications"]);

      let currentList: { slug: string | null; is_archive: boolean | null } | null = null;
      if (lead.list_id) {
        const { data } = await supabase
          .from("lead_lists")
          .select("slug, is_archive")
          .eq("id", lead.list_id)
          .maybeSingle();
        currentList = data;
      }
      const currentSlug = currentList?.slug ?? null;

      let targetSlug: string | null = null;
      const extraPayload: Record<string, unknown> = {};

      // 1) COUNSELOR ASSIGNED → Prospects (any performer)
      if (assignedIsCounselor) {
        // Academic hard-block: UNCHANGED wording/condition.
        if (
          !hasProspectQualification(lead as Record<string, unknown>) &&
          !canBypassProspectQualification(auth.permissions.baseTier, auth.positionSlug)
        ) {
          return apiValidationError({
            academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."],
          });
        }
        if (!["prospects", "applications"].includes(currentSlug ?? "")) {
          targetSlug = "prospects";
          extraPayload.lead_type = "prospect";
        }
      }
      // 2) NO COUNSELOR + elevated performer → Qualified
      else if (performerElevated) {
        if (!ADVANCED.has(currentSlug ?? "")) {
          targetSlug = "qualified";
          if (lead.assigned_to == null && auth.positionSlug === "lead-executive") {
            extraPayload.assigned_to = auth.userId;
          }
        }
      }

      if (targetSlug) {
        const { data: target } = await supabase
          .from("lead_lists")
          .select("id, pipeline_id")
          .eq("tenant_id", auth.tenantId)
          .eq("slug", targetSlug)
          .maybeSingle();

        if (target) {
          const promotePayload: Record<string, unknown> = {
            list_id: target.id,
            updated_at: new Date().toISOString(),
            ...extraPayload,
          };

          if (target.pipeline_id) {
            const landing = await getPipelineLandingStage(supabase, target.pipeline_id);
            if (landing) {
              promotePayload.pipeline_id = target.pipeline_id;
              promotePayload.stage_id = landing.id;
              promotePayload.status = landing.slug;
            }
          }

          // Un-archive: mirror leads/[id]/route.ts ~L658-663.
          if (lead.archived_at) {
            promotePayload.archived_at = null;
            promotePayload.archived_by = null;
            promotePayload.archived_from_list_id = null;
            promotePayload.archived_from_status = null;
          }

          const { error: promoteError } = await supabase
            .from("leads")
            .update(promotePayload)
            .eq("id", id)
            .eq("tenant_id", auth.tenantId);
          if (promoteError) {
            logger.error({ err: promoteError, leadId: id }, "Failed to auto-promote lead on check-in");
          }
        }
      }
    }
  } catch (promoteErr) {
    logger.error({ err: promoteErr, leadId: id }, "Unexpected error auto-promoting lead on check-in");
  }

  return apiSuccess({ checked_in: true, lead_id: id });
}
