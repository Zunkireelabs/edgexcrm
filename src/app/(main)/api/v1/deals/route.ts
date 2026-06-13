import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiPaginated,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { ensureDealPipeline } from "@/lib/deals/stages";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();

  const db = await scopedClient(auth);
  const defaultPipelineId = await ensureDealPipeline(db, auth.tenantId);

  const { searchParams } = new URL(request.url);
  const pipelineId = searchParams.get("pipeline_id") || defaultPipelineId;
  const stageId = searchParams.get("stage_id");
  const accountId = searchParams.get("account_id");
  const contactId = searchParams.get("contact_id");
  const ownerId = searchParams.get("owner_id");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10)));

  let query = db
    .from("deals")
    .select(
      "*, accounts!deals_account_id_fkey(id,name), contacts!deals_primary_contact_id_fkey(id,first_name,last_name)",
      { count: "exact" }
    )
    .is("deleted_at", null)
    .eq("pipeline_id", pipelineId);

  if (stageId) query = query.eq("stage_id", stageId);
  if (accountId) query = query.eq("account_id", accountId);
  if (contactId) query = query.eq("primary_contact_id", contactId);
  if (ownerId) query = query.eq("owner_id", ownerId);
  if (status) query = query.eq("status", status);
  if (search) query = query.ilike("name", `%${search}%`);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("last_activity_at", { ascending: false })
    .range(from, to);

  if (error) return apiError("DB_ERROR", "Failed to fetch deals", 500);

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
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/deals" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const defaultPipelineId = await ensureDealPipeline(db, auth.tenantId);

  // Resolve pipeline_id
  const pipelineId = (body.pipeline_id as string | undefined) || defaultPipelineId;

  // Resolve stage_id: use supplied (if in correct pipeline) else default stage of that pipeline
  let stageId = body.stage_id as string | undefined;
  if (!stageId) {
    const { data: defaultStage } = await db
      .from("deal_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("is_default", true)
      .maybeSingle();
    const defaultRow = defaultStage as unknown as { id: string } | null;
    if (!defaultRow) {
      const { data: firstStage } = await db
        .from("deal_stages")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      stageId = (firstStage as unknown as { id: string } | null)?.id;
    } else {
      stageId = defaultRow.id;
    }
  } else {
    // Validate supplied stage belongs to resolved pipeline
    const { data: stageCheck } = await db
      .from("deal_stages")
      .select("id")
      .eq("id", stageId)
      .eq("pipeline_id", pipelineId)
      .maybeSingle();
    if (!stageCheck) return apiError("NOT_FOUND", "Stage not found in this pipeline", 404);
  }

  if (!stageId) return apiError("NO_STAGES", "No deal stages found for this pipeline", 500);

  // Validate FK ownership for supplied IDs
  if (body.account_id) {
    const { data: acc } = await db.from("accounts").select("id").eq("id", String(body.account_id)).maybeSingle();
    if (!acc) return apiError("NOT_FOUND", "Account not found", 404);
  }
  if (body.primary_contact_id) {
    const { data: con } = await db.from("contacts").select("id").eq("id", String(body.primary_contact_id)).is("deleted_at", null).maybeSingle();
    if (!con) return apiError("NOT_FOUND", "Contact not found", 404);
  }
  if (body.owner_id) {
    const { data: member } = await db.from("tenant_users").select("user_id").eq("user_id", String(body.owner_id)).maybeSingle();
    if (!member) return apiError("NOT_FOUND", "Owner not found in this tenant", 404);
  }

  const insert: Record<string, unknown> = {
    name: String(body.name).trim(),
    stage_id: stageId,
    pipeline_id: pipelineId,
    status: "open",
    created_by: auth.userId,
  };
  if (body.amount !== undefined && body.amount !== null) insert.amount = Number(body.amount);
  if (body.currency) insert.currency = String(body.currency);
  if (body.close_date) insert.close_date = String(body.close_date);
  if (body.owner_id) insert.owner_id = String(body.owner_id);
  if (body.account_id) insert.account_id = String(body.account_id);
  if (body.primary_contact_id) insert.primary_contact_id = String(body.primary_contact_id);
  if (body.deal_type) insert.deal_type = String(body.deal_type);
  if (body.priority) insert.priority = String(body.priority);
  if (body.description) insert.description = String(body.description);

  const { data: created, error } = await db
    .from("deals")
    .insert(insert)
    .select("*, accounts!deals_account_id_fkey(id,name), contacts!deals_primary_contact_id_fkey(id,first_name,last_name)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create deal");
    return apiError("DB_ERROR", "Failed to create deal", 500);
  }

  const createdRow = created as unknown as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal.created",
      entityType: "deal",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal.created",
      entityType: "deal",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ dealId: createdRow.id }, "Deal created");
  return apiSuccess(created, 201);
}
