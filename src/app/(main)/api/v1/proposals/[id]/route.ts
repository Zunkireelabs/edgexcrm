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
import { maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { computeProposalTotals } from "@/industries/it-agency/features/proposals/lib/totals";

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
const DISCOUNT_TYPES = ["percent", "amount"] as const;

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: proposal, error } = await db
    .from("proposals")
    .select("*, deals!proposals_deal_id_fkey(id,name,currency)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch proposal", 500);
  if (!proposal) return apiNotFound("Proposal");

  const { data: lineItems } = await db
    .from("proposal_line_items")
    .select("*")
    .eq("proposal_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const proposalData = proposal as unknown as Record<string, unknown>;
  return apiSuccess({ ...proposalData, line_items: lineItems ?? [] });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/proposals/${id}` });

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

  if (body.title !== undefined) {
    const err = maxLength(200)(body.title);
    if (err) return apiValidationError({ title: [err] });
  }
  if (
    body.status !== undefined &&
    !STATUSES.includes(body.status as (typeof STATUSES)[number])
  ) {
    return apiValidationError({ status: [`Must be one of: ${STATUSES.join(", ")}`] });
  }
  if (
    body.discount_type !== undefined &&
    body.discount_type !== null &&
    !DISCOUNT_TYPES.includes(body.discount_type as (typeof DISCOUNT_TYPES)[number])
  ) {
    return apiValidationError({ discount_type: [`Must be one of: ${DISCOUNT_TYPES.join(", ")}`] });
  }
  for (const field of ["discount_value", "tax_percent"] as const) {
    if (body[field] === undefined || body[field] === null) continue;
    const num = Number(body[field]);
    if (!Number.isFinite(num) || num < 0) {
      return apiValidationError({ [field]: ["Must be a non-negative number"] });
    }
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("proposals")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Proposal");
  const existingRow = existing as unknown as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  if (body.valid_until !== undefined) patch.valid_until = body.valid_until ? String(body.valid_until) : null;
  if (body.discount_type !== undefined) patch.discount_type = body.discount_type;
  if (body.discount_value !== undefined) patch.discount_value = Number(body.discount_value);
  if (body.tax_percent !== undefined) patch.tax_percent = Number(body.tax_percent);

  let statusChanged = false;
  if (body.status !== undefined && body.status !== existingRow.status) {
    statusChanged = true;
    patch.status = body.status;
    if (body.status === "sent") patch.sent_at = new Date().toISOString();
    if (body.status === "accepted") patch.accepted_at = new Date().toISOString();
  }

  // Recompute totals if discount/tax changed (line-item mutations recompute via their own routes)
  const totalsAffectingChange =
    body.discount_type !== undefined || body.discount_value !== undefined || body.tax_percent !== undefined;
  if (totalsAffectingChange) {
    const { data: lineItems } = await db
      .from("proposal_line_items")
      .select("quantity, unit_price")
      .eq("proposal_id", id);
    const lines = (lineItems ?? []) as unknown as { quantity: number; unit_price: number }[];
    const discountType = (patch.discount_type ?? existingRow.discount_type) as "percent" | "amount" | null;
    const discountValue = (patch.discount_value ?? existingRow.discount_value) as number;
    const taxPercent = (patch.tax_percent ?? existingRow.tax_percent) as number;
    const { subtotal, total } = computeProposalTotals(lines, discountType, discountValue, taxPercent);
    patch.subtotal = subtotal;
    patch.total = total;
  }

  const { data: updated, error } = await db
    .from("proposals")
    .update(patch)
    .eq("id", id)
    .select("*, deals!proposals_deal_id_fkey(id,name,currency)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update proposal");
    return apiError("DB_ERROR", "Failed to update proposal", 500);
  }

  if (statusChanged && body.status === "accepted" && body.sync_to_deal === true) {
    const updatedRow = updated as unknown as { total: number; deal_id: string };
    await db
      .from("deals")
      .update({ amount: updatedRow.total })
      .eq("id", updatedRow.deal_id);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.updated",
      entityType: "proposal",
      entityId: id,
      changes: { patch: { old: existingRow, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.updated",
      entityType: "proposal",
      entityId: id,
      requestId,
      payload: { changed_fields: Object.keys(patch), old: existingRow, new: patch },
    }),
  ]);

  log.info({ proposalId: id }, "Proposal updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/proposals/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("proposals")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Proposal");

  const { error } = await db
    .from("proposals")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete proposal");
    return apiError("DB_ERROR", "Failed to delete proposal", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.deleted",
      entityType: "proposal",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.deleted",
      entityType: "proposal",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ proposalId: id }, "Proposal deleted");
  return apiSuccess({ id });
}
