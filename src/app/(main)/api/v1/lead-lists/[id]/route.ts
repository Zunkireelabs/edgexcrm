import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiServiceUnavailable,
  apiConflict,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createRequestLogger } from "@/lib/logger";
import type { LeadList } from "@/types/database";

function validateAccess(access: unknown): string | null {
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    return "access must be an object";
  }
  const a = access as Record<string, unknown>;
  if (a.mode !== "all" && a.mode !== "allow") {
    return 'access.mode must be "all" or "allow"';
  }
  if (a.mode === "allow") {
    if (!Array.isArray(a.positionIds) || a.positionIds.some((p) => typeof p !== "string")) {
      return "access.positionIds must be an array of strings";
    }
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/lead-lists/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db.from("lead_lists").select("*").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Lead list");
  const list = existing as unknown as LeadList;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = (body.name as string).trim();
    if (!name) return apiValidationError({ name: ["name cannot be empty"] });
    update.name = name;
  }
  if (body.sort_order !== undefined) {
    update.sort_order = body.sort_order;
  }
  if (body.color !== undefined) {
    update.color = body.color;
  }
  if (body.access !== undefined) {
    const accessErr = validateAccess(body.access);
    if (accessErr) return apiValidationError({ access: [accessErr] });
    update.access = body.access;
  }
  // System lists: block is_archive / is_intake changes via API (structural flags set at seed time)
  if (!list.is_system) {
    if (body.is_archive !== undefined) update.is_archive = body.is_archive;
  }

  if (Object.keys(update).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await db
    .from("lead_lists")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update lead list");
    return apiServiceUnavailable("Failed to update lead list");
  }

  log.info({ listId: id }, "Lead list updated");
  return apiSuccess(updated as LeadList);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/lead-lists/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db.from("lead_lists").select("*").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Lead list");
  const list = existing as unknown as LeadList;

  if (list.is_system) {
    return apiForbidden();
  }

  // Block delete if any lead is in this list
  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("list_id", id);

  if (count && count > 0) {
    return apiConflict(`Cannot delete a list that contains ${count} lead(s). Move or archive them first.`);
  }

  const { error } = await db.from("lead_lists").delete().eq("id", id);

  if (error) {
    log.error({ err: error }, "Failed to delete lead list");
    return apiServiceUnavailable("Failed to delete lead list");
  }

  log.info({ listId: id }, "Lead list deleted");
  return apiSuccess({ id });
}
