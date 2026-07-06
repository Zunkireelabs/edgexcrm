import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

const PROJECT_STATUSES = ["planning", "active", "in_review", "delivered", "on_hold", "cancelled"];

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/deals/${id}/convert-to-project` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);

  const { data: deal } = await db
    .from("deals")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!deal) return apiNotFound("Deal");
  const dealRow = deal as unknown as Record<string, unknown>;

  const { data: existingRaw } = await db
    .from("projects")
    .select("id, name")
    .eq("deal_id", id)
    .maybeSingle();
  const existing = existingRaw as unknown as { id: string; name: string } | null;
  if (existing) {
    return apiError("ALREADY_CONVERTED", "Deal already converted to a project", 409, {
      project_id: existing.id,
    });
  }

  const accountId = (body.account_id as string | undefined) ?? (dealRow.account_id as string | null);
  if (!accountId) {
    return apiValidationError({ account_id: ["A project needs an account; select one"] });
  }
  const { data: account } = await db.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!account) return apiNotFound("Account");

  const status = PROJECT_STATUSES.includes(String(body.status)) ? String(body.status) : "planning";
  const name = (body.name ? String(body.name).trim() : "") || String(dealRow.name);
  const notes = body.notes ? String(body.notes).trim() : (dealRow.description as string | null) ?? null;

  const { data: created, error } = await db
    .from("projects")
    .insert({
      account_id: accountId,
      name,
      status,
      owner_id: dealRow.owner_id as string | null,
      notes,
      is_billable: true,
      default_rate: null,
      deal_id: id,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to convert deal to project");
    return apiError("DB_ERROR", "Failed to convert deal to project", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal.converted_to_project",
      entityType: "deal",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project.created",
      entityType: "project",
      entityId: created.id,
      requestId,
      payload: { source_deal_id: id },
    }),
  ]);

  log.info({ dealId: id, projectId: created.id }, "Deal converted to project");
  return apiSuccess(created, 201);
}
