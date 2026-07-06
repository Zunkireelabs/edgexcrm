import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/proposals/${id}/duplicate` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: source } = await db
    .from("proposals")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!source) return apiNotFound("Proposal");
  const sourceRow = source as unknown as {
    deal_id: string;
    title: string;
    currency: string;
    discount_type: "percent" | "amount" | null;
    discount_value: number;
    tax_percent: number;
    notes: string | null;
    valid_until: string | null;
    subtotal: number;
    total: number;
  };

  const { data: sourceLines } = await db
    .from("proposal_line_items")
    .select("*")
    .eq("proposal_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const lines = (sourceLines ?? []) as unknown as {
    service_id: string | null;
    name: string;
    description: string | null;
    billing_type: string | null;
    quantity: number;
    unit_price: number;
    hours: number | null;
    line_total: number;
    sort_order: number;
  }[];

  const { data: created, error } = await db
    .from("proposals")
    .insert({
      deal_id: sourceRow.deal_id,
      title: `${sourceRow.title} (Copy)`,
      status: "draft",
      currency: sourceRow.currency,
      discount_type: sourceRow.discount_type,
      discount_value: sourceRow.discount_value,
      tax_percent: sourceRow.tax_percent,
      notes: sourceRow.notes,
      valid_until: sourceRow.valid_until,
      subtotal: sourceRow.subtotal,
      total: sourceRow.total,
      sent_at: null,
      accepted_at: null,
      public_token: null,
      public_enabled: false,
      created_by: auth.userId,
    })
    .select("*, deals!proposals_deal_id_fkey(id,name,currency)")
    .single();

  if (error) {
    log.error({ error }, "Failed to duplicate proposal");
    return apiError("DB_ERROR", "Failed to duplicate proposal", 500);
  }

  const createdRow = created as unknown as { id: string };

  if (lines.length > 0) {
    const { error: lineError } = await db.from("proposal_line_items").insert(
      lines.map((l) => ({
        proposal_id: createdRow.id,
        service_id: l.service_id,
        name: l.name,
        description: l.description,
        billing_type: l.billing_type,
        quantity: l.quantity,
        unit_price: l.unit_price,
        hours: l.hours,
        line_total: l.line_total,
        sort_order: l.sort_order,
      }))
    );
    if (lineError) {
      log.error({ error: lineError }, "Failed to duplicate proposal line items");
      return apiError("DB_ERROR", "Failed to duplicate line items", 500);
    }
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.duplicated",
      entityType: "proposal",
      entityId: createdRow.id,
      changes: { source_proposal_id: { old: null, new: id } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.duplicated",
      entityType: "proposal",
      entityId: createdRow.id,
      requestId,
      payload: { source_proposal_id: id },
    }),
  ]);

  log.info({ sourceProposalId: id, newProposalId: createdRow.id }, "Proposal duplicated");
  return apiSuccess(created, 201);
}
