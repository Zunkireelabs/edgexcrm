import { NextRequest } from "next/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import {
  apiSuccess,
  apiPaginated,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { shouldRestrictToSelf, canManageClasses } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const leadId = searchParams.get("lead_id");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10)));

  let query = db
    .from("class_enrollments")
    .select(
      "*, classes!class_enrollments_class_id_fkey(id,name,default_fee), leads!class_enrollments_lead_id_fkey(id,first_name,last_name,email,assigned_to)",
      { count: "exact" }
    )
    .is("deleted_at", null);

  if (classId) query = query.eq("class_id", classId);
  if (leadId) query = query.eq("lead_id", leadId);

  // Counselor scoping: restrict to enrollments whose parent lead is assigned to this user
  if (shouldRestrictToSelf(auth.permissions)) {
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
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return apiError("DB_ERROR", "Failed to fetch class enrollments", 500);

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
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/class-enrollments" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!canManageClasses(auth.permissions)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    lead_id: [required("lead_id")],
    class_id: [required("class_id")],
  });
  if (!valid) return apiValidationError(errors);

  const supabase = await createServiceClient();
  const db = await scopedClient(auth);

  // Verify class exists, belongs to tenant, and is active
  const { data: classRow } = await db
    .from("classes")
    .select("id, name, default_fee, is_active")
    .eq("id", String(body.class_id))
    .maybeSingle();
  if (!classRow) return apiNotFound("Class");
  const cls = classRow as unknown as { id: string; name: string; default_fee: number | null; is_active: boolean };
  if (!cls.is_active) return apiError("CLASS_INACTIVE", "This class is not active", 400);

  // Verify lead exists and belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, list_id, assigned_to, branch_id")
    .eq("id", String(body.lead_id))
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");

  const leadRow = lead as unknown as { id: string; list_id: string | null; assigned_to: string | null; branch_id: string | null };

  // Parent-lead scope check
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

  // Validate fields
  const feePaid = body.fee_paid === undefined ? false : Boolean(body.fee_paid);
  let feeAmount: number | null = null;
  if (body.fee_amount !== undefined && body.fee_amount !== null) {
    feeAmount = Number(body.fee_amount);
    if (isNaN(feeAmount) || feeAmount < 0) return apiValidationError({ fee_amount: ["fee_amount must be a non-negative number"] });
  }
  const notes = body.notes ? String(body.notes) : null;

  const insert: Record<string, unknown> = {
    lead_id: leadRow.id,
    class_id: cls.id,
    fee_paid: feePaid,
    fee_amount: feeAmount,
    notes,
  };

  const { data: created, error: insertError } = await db
    .from("class_enrollments")
    .insert(insert)
    .select("*, classes!class_enrollments_class_id_fkey(id,name,default_fee)")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return apiConflict("This student is already enrolled in this class.");
    }
    log.error({ error: insertError }, "Failed to create enrollment");
    return apiError("DB_ERROR", "Failed to create enrollment", 500);
  }

  const createdRow = created as unknown as { id: string };
  const auditEvents: Promise<unknown>[] = [
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class.enrolled",
      entityType: "class_enrollment",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class.enrolled",
      entityType: "class_enrollment",
      entityId: createdRow.id,
      requestId,
    }),
  ];

  // Auto-move: if lead's current list is below Qualified (or NULL), move to Qualified
  if (leadRow.list_id === null) {
    // No list → move to Qualified
    await autoMoveToQualified(supabase, db, auth, leadRow.id, leadRow.list_id, requestId, auditEvents, log);
  } else {
    // Check sort_order relative to Qualified
    const { data: currentList } = await supabase
      .from("lead_lists")
      .select("slug, sort_order, name")
      .eq("id", leadRow.list_id)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();

    const { data: qualifiedList } = await supabase
      .from("lead_lists")
      .select("id, sort_order, name")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", "qualified")
      .maybeSingle();

    const currentListRow = currentList as { slug: string; sort_order: number; name: string } | null;
    const qualifiedListRow = qualifiedList as { id: string; sort_order: number; name: string } | null;

    if (
      qualifiedListRow &&
      currentListRow &&
      currentListRow.sort_order < qualifiedListRow.sort_order
    ) {
      await autoMoveToQualified(supabase, db, auth, leadRow.id, leadRow.list_id, requestId, auditEvents, log, currentListRow.name, qualifiedListRow);
    }
  }

  await Promise.all(auditEvents);
  log.info({ enrollmentId: createdRow.id }, "Class enrollment created");
  return apiSuccess(created, 201);
}

async function autoMoveToQualified(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  db: Awaited<ReturnType<typeof scopedClient>>,
  auth: { tenantId: string; userId: string },
  leadId: string,
  oldListId: string | null,
  requestId: string,
  auditEvents: Promise<unknown>[],
  log: { error: (ctx: unknown, msg: string) => void },
  oldListName?: string,
  qualifiedList?: { id: string; sort_order: number; name: string } | null,
) {
  // Resolve qualified list if not already provided
  let targetList = qualifiedList;
  let oldName = oldListName ?? null;

  if (!targetList) {
    const { data } = await supabase
      .from("lead_lists")
      .select("id, sort_order, name")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", "qualified")
      .maybeSingle();
    targetList = data as { id: string; sort_order: number; name: string } | null;
  }

  if (!targetList) return; // no qualified list → skip

  if (!oldName && oldListId) {
    const { data } = await supabase
      .from("lead_lists")
      .select("name")
      .eq("id", oldListId)
      .maybeSingle();
    oldName = (data as { name: string } | null)?.name ?? null;
  }

  const { error: moveError } = await supabase
    .from("leads")
    .update({ list_id: targetList.id })
    .eq("id", leadId)
    .eq("tenant_id", auth.tenantId);

  if (moveError) {
    log.error({ error: moveError }, "Failed to auto-move lead to Qualified");
    return;
  }

  auditEvents.push(
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.updated",
      entityType: "lead",
      entityId: leadId,
      changes: { list: { old: oldName, new: targetList.name } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.list_changed",
      entityType: "lead",
      entityId: leadId,
      requestId,
      payload: { old_list_id: oldListId, new_list_id: targetList.id, trigger: "class.enrolled" },
    })
  );
}
