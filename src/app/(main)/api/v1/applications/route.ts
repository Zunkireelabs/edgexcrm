import { NextRequest } from "next/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import {
  apiSuccess,
  apiPaginated,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
  apiNotFound,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { shouldRestrictToSelf, canManageApplications } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);

  const stageId = searchParams.get("stage_id");
  const status = searchParams.get("status");
  const country = searchParams.get("country");
  const leadId = searchParams.get("lead_id");
  const assignedTo = searchParams.get("assigned_to");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10)));

  let query = db
    .from("applications")
    .select(
      "*, leads!applications_lead_id_fkey(id,first_name,last_name,email), application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type)",
      { count: "exact" }
    )
    .is("deleted_at", null);

  if (stageId) query = query.eq("stage_id", stageId);
  if (status) query = query.eq("status", status);
  if (country) query = query.eq("country", country);
  if (leadId) query = query.eq("lead_id", leadId);

  // Counselor scoping: only applications belonging to their own leads
  if (shouldRestrictToSelf(auth.permissions)) {
    // Get lead IDs assigned to this counselor
    const { data: assignedLeads } = await db
      .from("leads")
      .select("id")
      .eq("assigned_to", auth.userId)
      .is("deleted_at", null);
    const assignedLeadIds = ((assignedLeads ?? []) as unknown as { id: string }[]).map((l) => l.id);
    if (assignedLeadIds.length === 0) {
      return apiPaginated([], { page, pageSize, total: 0, totalPages: 0 });
    }
    query = query.in("lead_id", assignedLeadIds);
  } else if (assignedTo) {
    query = query.eq("assigned_to", assignedTo);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return apiError("DB_ERROR", "Failed to fetch applications", 500);

  const total = count ?? 0;
  return apiPaginated(data ?? [], {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/applications" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    lead_id: [required("lead_id")],
    university_name: [required("university_name"), maxLength(255)],
    program_name: [required("program_name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const supabase = await createServiceClient();
  const db = await scopedClient(auth);

  // Verify lead exists and belongs to this tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, lead_type, assigned_to, branch_id")
    .eq("id", String(body.lead_id))
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");

  // Parent-lead scope check: actor may only write to a lead they can access
  const leadRow = lead as unknown as { id: string; lead_type: string | null; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, leadRow.id);
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

  // Standalone board create gate — the coarse canManageApplications flag (spec §8:
  // the standalone board is out of scope for the branch/assignee-aware model). The
  // lead-detail PANEL route uses canCreateOrReorderApplications instead.
  if (!canManageApplications(auth.permissions)) return apiForbidden();

  // Consent gate — only enforced if the tenant has an ACTIVE consent template
  const { data: consentTpl } = await supabase.from("consent_templates")
    .select("is_active").eq("tenant_id", auth.tenantId).maybeSingle();
  if ((consentTpl as { is_active: boolean } | null)?.is_active) {
    const { data: signed } = await supabase.from("lead_consents")
      .select("id").eq("tenant_id", auth.tenantId).eq("lead_id", leadRow.id)
      .eq("status", "signed").is("deleted_at", null).limit(1).maybeSingle();
    if (!signed) return apiError("CONSENT_REQUIRED", "Student consent must be signed before creating an application", 409);
  }

  // Resolve stage: use supplied stage_id or default to the 'shortlisted' (is_default) stage
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

  // Append to the end of the lead's panel order (position = current max + 1).
  const { data: maxRow } = await db
    .from("applications")
    .select("position")
    .eq("lead_id", leadRow.id)
    .is("deleted_at", null)
    .order("position", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (((maxRow as { position: number | null } | null)?.position ?? -1) + 1);

  const insert: Record<string, unknown> = {
    lead_id: leadRow.id,
    university_name: String(body.university_name).trim(),
    program_name: String(body.program_name).trim(),
    stage_id: stageId,
    status: stageSlug,
    position: nextPosition,
    created_by: auth.userId,
  };
  if (body.intake_term) insert.intake_term = String(body.intake_term);
  if (body.country) insert.country = String(body.country);
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
  if (body.degree_level) insert.degree_level = String(body.degree_level);
  if (body.field_of_study) insert.field_of_study = String(body.field_of_study);

  const { data: created, error } = await db
    .from("applications")
    .insert(insert)
    .select("*, leads!applications_lead_id_fkey(id,first_name,last_name,email), application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create application");
    return apiError("DB_ERROR", "Failed to create application", 500);
  }

  const createdRow = created as unknown as { id: string };
  const auditEvents: Promise<unknown>[] = [
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
  ];

  // Auto-promote lead to 'prospect' if not already (global board path)
  if (leadRow.lead_type !== "prospect") {
    const { error: promoteError } = await db
      .from("leads")
      .update({ lead_type: "prospect" })
      .eq("id", leadRow.id);

    if (!promoteError) {
      auditEvents.push(
        createAuditLog({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: "lead.promoted_to_prospect",
          entityType: "lead",
          entityId: leadRow.id,
          changes: { patch: { old: { lead_type: leadRow.lead_type }, new: { lead_type: "prospect" } } },
          requestId,
        }),
        emitEvent({
          tenantId: auth.tenantId,
          type: "lead.promoted_to_prospect",
          entityType: "lead",
          entityId: leadRow.id,
          requestId,
          payload: { trigger: "application.created", application_id: createdRow.id },
        })
      );
    } else {
      log.error({ error: promoteError }, "Failed to auto-promote lead to prospect");
    }
  }

  await Promise.all(auditEvents);
  log.info({ applicationId: createdRow.id }, "Application created");
  return apiSuccess(created, 201);
}
