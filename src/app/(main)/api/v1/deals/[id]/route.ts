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

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("deals")
    .select("*, accounts!deals_account_id_fkey(id,name), contacts!deals_primary_contact_id_fkey(id,first_name,last_name)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch deal", 500);
  if (!data) return apiNotFound("Deal");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/deals/${id}` });

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

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("deals")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Deal");

  const existingRow = existing as unknown as Record<string, unknown>;

  // Validate FK ownership for supplied IDs
  if (body.account_id !== undefined && body.account_id !== null) {
    const { data: acc } = await db.from("accounts").select("id").eq("id", String(body.account_id)).maybeSingle();
    if (!acc) return apiError("NOT_FOUND", "Account not found", 404);
  }
  if (body.primary_contact_id !== undefined && body.primary_contact_id !== null) {
    const { data: con } = await db.from("contacts").select("id").eq("id", String(body.primary_contact_id)).is("deleted_at", null).maybeSingle();
    if (!con) return apiError("NOT_FOUND", "Contact not found", 404);
  }
  if (body.owner_id !== undefined && body.owner_id !== null) {
    const { data: member } = await db.from("tenant_users").select("user_id").eq("user_id", String(body.owner_id)).maybeSingle();
    if (!member) return apiError("NOT_FOUND", "Owner not found in this tenant", 404);
  }

  const patch: Record<string, unknown> = {};
  const updatable = ["name", "amount", "currency", "close_date", "owner_id", "account_id", "primary_contact_id", "deal_type", "priority", "description"];
  for (const field of updatable) {
    if (body[field] !== undefined) patch[field] = body[field] ?? null;
  }

  // Stage change: derive status and bump last_activity_at
  const stageChanged = body.stage_id !== undefined && body.stage_id !== existingRow.stage_id;
  if (body.stage_id !== undefined) {
    patch.stage_id = body.stage_id;
    if (stageChanged) {
      const { data: stage } = await db
        .from("deal_stages")
        .select("terminal_type, is_terminal")
        .eq("id", String(body.stage_id))
        .maybeSingle();
      const stageRow = stage as { terminal_type: string | null; is_terminal: boolean } | null;
      if (stageRow?.is_terminal && stageRow.terminal_type) {
        patch.status = stageRow.terminal_type; // 'won' or 'lost'
      } else {
        patch.status = "open";
      }
      patch.last_activity_at = new Date().toISOString();
    }
  }

  if (Object.keys(patch).length === 0) return apiSuccess(existingRow);

  const { data: updated, error } = await db
    .from("deals")
    .update(patch)
    .eq("id", id)
    .select("*, accounts!deals_account_id_fkey(id,name), contacts!deals_primary_contact_id_fkey(id,first_name,last_name)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update deal");
    return apiError("DB_ERROR", "Failed to update deal", 500);
  }

  const events: Promise<unknown>[] = [
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal.updated",
      entityType: "deal",
      entityId: id,
      changes: { patch: { old: existingRow, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal.updated",
      entityType: "deal",
      entityId: id,
      requestId,
      payload: { changed_fields: Object.keys(patch), old: existingRow, new: patch },
    }),
  ];

  if (stageChanged) {
    events.push(
      emitEvent({
        tenantId: auth.tenantId,
        type: "deal.stage_changed",
        entityType: "deal",
        entityId: id,
        requestId,
        payload: { old_stage_id: existingRow.stage_id, new_stage_id: body.stage_id },
      })
    );
  }

  await Promise.all(events);

  log.info({ dealId: id }, "Deal updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/deals/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("deals")
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Deal");

  const { error } = await db
    .from("deals")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete deal");
    return apiError("DB_ERROR", "Failed to delete deal", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal.deleted",
      entityType: "deal",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal.deleted",
      entityType: "deal",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ dealId: id }, "Deal deleted");
  return apiSuccess({ id });
}
