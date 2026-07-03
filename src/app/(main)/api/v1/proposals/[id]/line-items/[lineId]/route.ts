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
import { recomputeAndPersistTotals } from "@/industries/it-agency/features/proposals/lib/totals";

interface Props {
  params: Promise<{ id: string; lineId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id, lineId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/proposals/${id}/line-items/${lineId}`,
  });

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

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("proposal_line_items")
    .select("*")
    .eq("id", lineId)
    .eq("proposal_id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Line item");
  const existingRow = existing as unknown as { quantity: number; unit_price: number };

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return apiValidationError({ name: ["name is required"] });
    patch.name = String(body.name).trim();
  }
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);

  for (const field of ["quantity", "unit_price", "hours"] as const) {
    if (body[field] === undefined) continue;
    if (body[field] === null && field === "hours") {
      patch.hours = null;
      continue;
    }
    const num = Number(body[field]);
    if (!Number.isFinite(num) || num < 0) {
      return apiValidationError({ [field]: ["Must be a non-negative number"] });
    }
    patch[field] = num;
  }

  const newQuantity = (patch.quantity as number) ?? existingRow.quantity;
  const newUnitPrice = (patch.unit_price as number) ?? existingRow.unit_price;
  if (patch.quantity !== undefined || patch.unit_price !== undefined) {
    patch.line_total = newQuantity * newUnitPrice;
  }

  const { data: updated, error } = await db
    .from("proposal_line_items")
    .update(patch)
    .eq("id", lineId)
    .eq("proposal_id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update proposal line item");
    return apiError("DB_ERROR", "Failed to update line item", 500);
  }

  await recomputeAndPersistTotals(db, id);

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.line_item_updated",
      entityType: "proposal_line_item",
      entityId: lineId,
      changes: { patch: { old: existingRow, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.line_item_updated",
      entityType: "proposal_line_item",
      entityId: lineId,
      requestId,
      payload: { proposal_id: id, changed_fields: Object.keys(patch) },
    }),
  ]);

  log.info({ proposalId: id, lineItemId: lineId }, "Proposal line item updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id, lineId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/proposals/${id}/line-items/${lineId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("proposal_line_items")
    .select("id")
    .eq("id", lineId)
    .eq("proposal_id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Line item");

  const { error } = await db
    .from("proposal_line_items")
    .delete()
    .eq("id", lineId)
    .eq("proposal_id", id);

  if (error) {
    log.error({ error }, "Failed to delete proposal line item");
    return apiError("DB_ERROR", "Failed to delete line item", 500);
  }

  await recomputeAndPersistTotals(db, id);

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.line_item_deleted",
      entityType: "proposal_line_item",
      entityId: lineId,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.line_item_deleted",
      entityType: "proposal_line_item",
      entityId: lineId,
      requestId,
      payload: { proposal_id: id },
    }),
  ]);

  log.info({ proposalId: id, lineItemId: lineId }, "Proposal line item deleted");
  return apiSuccess({ id: lineId });
}
