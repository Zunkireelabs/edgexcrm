import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, resolvePositionSlug } from "@/lib/api/auth";
import { logger } from "@/lib/logger";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

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
    .select("id, list_id, assigned_to")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  let reason = "";
  try {
    const body = await request.json();
    reason = (body.reason as string) || "";
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
  });

  if (error) {
    return apiServiceUnavailable("Failed to log check-in");
  }

  // Auto-promote into the "Prospects" list on first check-in — forward-only,
  // never regress a lead that's already at Prospects or further along
  // (Applications/Archived). Best-effort: a failure here must not fail the
  // check-in itself, since the note is already logged.
  // Promotion is gated on the lead being assigned to a counselor-position user.
  // A lead-exec self-assignment also sets assigned_to but must stay in Qualified.
  let assignedIsCounselor = false;
  if (lead.assigned_to) {
    const assignedPositionSlug = await resolvePositionSlug(supabase, auth.tenantId, lead.assigned_to);
    assignedIsCounselor = assignedPositionSlug === "counselor";
  }

  try {
    const { data: prospectsList } = await supabase
      .from("lead_lists")
      .select("id, sort_order, pipeline_id")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", "prospects")
      .maybeSingle();

    if (prospectsList && assignedIsCounselor) {
      let currentSortOrder: number | null = null;
      let currentIsStaging = false;
      if (lead.list_id) {
        const { data: currentList } = await supabase
          .from("lead_lists")
          .select("sort_order, is_staging")
          .eq("id", lead.list_id)
          .maybeSingle();
        currentSortOrder = currentList?.sort_order ?? null;
        currentIsStaging = currentList?.is_staging ?? false;
      }

      // Staging/intake lists (e.g. "New Leads") sit outside the normal
      // sort_order funnel — always treat them as behind Prospects.
      if (currentSortOrder === null || currentIsStaging || currentSortOrder < prospectsList.sort_order) {
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

        const { error: promoteError } = await supabase
          .from("leads")
          .update(promotePayload)
          .eq("id", id)
          .eq("tenant_id", auth.tenantId);
        if (promoteError) {
          logger.error({ err: promoteError, leadId: id }, "Failed to auto-promote lead to Prospects on check-in");
        }
      }
    }
  } catch (promoteErr) {
    logger.error({ err: promoteErr, leadId: id }, "Unexpected error auto-promoting lead to Prospects on check-in");
  }

  return apiSuccess({ checked_in: true, lead_id: id });
}
