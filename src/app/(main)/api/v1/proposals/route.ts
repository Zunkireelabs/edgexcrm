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
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("deal_id");
  const status = searchParams.get("status");

  let query = db
    .from("proposals")
    .select("*, deals!proposals_deal_id_fkey(id,name,currency)")
    .is("deleted_at", null);

  if (dealId) query = query.eq("deal_id", dealId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return apiError("DB_ERROR", "Failed to fetch proposals", 500);

  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/proposals" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    deal_id: [required("deal_id")],
    title: [required("title"), maxLength(200)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: deal } = await db
    .from("deals")
    .select("id, currency")
    .eq("id", String(body.deal_id))
    .is("deleted_at", null)
    .maybeSingle();
  const dealRow = deal as unknown as { id: string; currency: string } | null;
  if (!dealRow) return apiNotFound("Deal");

  const insert: Record<string, unknown> = {
    deal_id: dealRow.id,
    title: String(body.title).trim(),
    status: "draft",
    currency: dealRow.currency,
    created_by: auth.userId,
  };
  if (body.valid_until) insert.valid_until = String(body.valid_until);

  const { data: created, error } = await db
    .from("proposals")
    .insert(insert)
    .select("*, deals!proposals_deal_id_fkey(id,name,currency)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create proposal");
    return apiError("DB_ERROR", "Failed to create proposal", 500);
  }

  const createdRow = created as unknown as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.created",
      entityType: "proposal",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.created",
      entityType: "proposal",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ proposalId: createdRow.id }, "Proposal created");
  return apiSuccess(created, 201);
}
