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
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/proposals/${id}/line-items` });

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

  const { data: proposal } = await db
    .from("proposals")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!proposal) return apiNotFound("Proposal");

  let insert: Record<string, unknown>;

  if (body.service_id) {
    const { data: service } = await db
      .from("services")
      .select("*")
      .eq("id", String(body.service_id))
      .maybeSingle();
    const serviceRow = service as unknown as {
      id: string;
      name: string;
      description: string | null;
      price: number | null;
      hours: number | null;
      billing_type: string;
    } | null;
    if (!serviceRow) return apiNotFound("Service");

    const quantity = body.quantity !== undefined ? Number(body.quantity) : 1;
    if (!Number.isFinite(quantity) || quantity < 0) {
      return apiValidationError({ quantity: ["Must be a non-negative number"] });
    }

    insert = {
      proposal_id: id,
      service_id: serviceRow.id,
      name: serviceRow.name,
      description: serviceRow.description,
      billing_type: serviceRow.billing_type,
      quantity,
      unit_price: serviceRow.price ?? 0,
      hours: serviceRow.hours,
    };
  } else {
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return apiValidationError({ name: ["name is required"] });
    }
    const quantity = body.quantity !== undefined ? Number(body.quantity) : 1;
    const unitPrice = body.unit_price !== undefined ? Number(body.unit_price) : 0;
    if (!Number.isFinite(quantity) || quantity < 0) {
      return apiValidationError({ quantity: ["Must be a non-negative number"] });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return apiValidationError({ unit_price: ["Must be a non-negative number"] });
    }

    insert = {
      proposal_id: id,
      service_id: null,
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
      billing_type: null,
      quantity,
      unit_price: unitPrice,
      hours: body.hours !== undefined && body.hours !== null && body.hours !== "" ? Number(body.hours) : null,
    };
  }

  const { data: maxSort } = await db
    .from("proposal_line_items")
    .select("sort_order")
    .eq("proposal_id", id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = ((maxSort as unknown as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  insert.sort_order = nextSortOrder;
  insert.line_total = (insert.quantity as number) * (insert.unit_price as number);

  const { data: created, error } = await db
    .from("proposal_line_items")
    .insert(insert)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create proposal line item");
    return apiError("DB_ERROR", "Failed to create line item", 500);
  }

  await recomputeAndPersistTotals(db, id);

  const createdRow = created as unknown as { id: string };
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "proposal.line_item_created",
      entityType: "proposal_line_item",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "proposal.line_item_created",
      entityType: "proposal_line_item",
      entityId: createdRow.id,
      requestId,
      payload: { proposal_id: id },
    }),
  ]);

  log.info({ proposalId: id, lineItemId: createdRow.id }, "Proposal line item created");
  return apiSuccess(created, 201);
}
