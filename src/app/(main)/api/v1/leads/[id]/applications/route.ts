import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { shouldRestrictToSelf, canManageApplications } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/:id/applications
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null };

  // Counselor: own leads only; branch-manager: membership-based
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId) ||
      leadRow.assigned_to === auth.userId
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("applications")
    .select("*, application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type)")
    .eq("lead_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch applications", 500);
  return apiSuccess(data ?? []);
}

// POST /api/v1/leads/:id/applications — lead is already a prospect; no promote needed
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/applications` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!canManageApplications(auth.permissions)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists, belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id, lead_type")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null; lead_type: string | null };

  // Parent-lead scope check (mirrors the GET scope check on this same route)
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      leadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    university_name: [required("university_name"), maxLength(255)],
    program_name: [required("program_name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Resolve stage
  let stageId = body.stage_id as string | undefined;
  let stageSlug = "shortlisted";
  if (!stageId) {
    const { data: defaultStage } = await db
      .from("application_stages")
      .select("id, slug")
      .eq("is_default", true)
      .maybeSingle();
    const ds = defaultStage as { id: string; slug: string } | null;
    if (ds) { stageId = ds.id; stageSlug = ds.slug; }
    else {
      const { data: firstStage } = await db
        .from("application_stages")
        .select("id, slug")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      const fs = firstStage as { id: string; slug: string } | null;
      if (fs) { stageId = fs.id; stageSlug = fs.slug; }
    }
  } else {
    const { data: stageCheck } = await db
      .from("application_stages")
      .select("id, slug")
      .eq("id", stageId)
      .maybeSingle();
    const sc = stageCheck as { id: string; slug: string } | null;
    if (!sc) return apiError("NOT_FOUND", "Application stage not found", 404);
    stageSlug = sc.slug;
  }

  if (!stageId) return apiError("NO_STAGES", "No application stages found for this tenant", 500);

  const insert: Record<string, unknown> = {
    lead_id: leadRow.id,
    university_name: String(body.university_name).trim(),
    program_name: String(body.program_name).trim(),
    stage_id: stageId,
    status: stageSlug,
  };
  if (body.intake_term) insert.intake_term = String(body.intake_term);
  if (body.country) insert.country = String(body.country);
  if (body.assigned_to) insert.assigned_to = String(body.assigned_to);
  if (body.application_deadline) insert.application_deadline = String(body.application_deadline);
  if (body.application_fee_paid !== undefined) insert.application_fee_paid = Boolean(body.application_fee_paid);
  if (body.tuition_fee !== undefined && body.tuition_fee !== null) insert.tuition_fee = Number(body.tuition_fee);
  if (body.deposit_paid !== undefined) insert.deposit_paid = Boolean(body.deposit_paid);
  if (body.offer_letter_url) insert.offer_letter_url = String(body.offer_letter_url);
  if (body.notes) insert.notes = String(body.notes);
  if (body.offer_type && ["conditional", "unconditional"].includes(String(body.offer_type))) {
    insert.offer_type = body.offer_type;
  }
  if (body.agent_id) insert.agent_id = String(body.agent_id);
  if (body.applied_date) insert.applied_date = String(body.applied_date);
  if (body.intake_start_date) insert.intake_start_date = String(body.intake_start_date);

  const { data: created, error } = await db
    .from("applications")
    .insert(insert)
    .select("*, application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create application");
    return apiError("DB_ERROR", "Failed to create application", 500);
  }

  const createdRow = created as unknown as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "application.created",
      entityType: "application",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "application.created",
      entityType: "application",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ applicationId: createdRow.id }, "Application created via lead panel");
  return apiSuccess(created, 201);
}
