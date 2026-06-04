import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { validatePositionPermissions, deriveRole } from "@/lib/api/permissions";
import type { PositionPermissions } from "@/lib/api/permissions";
import type { Position } from "@/types/database";

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/positions/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const db = await scopedClient(auth);

  const { data: positionData } = await db
    .from("positions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!positionData) return apiNotFound("Position");

  const position = positionData as unknown as Position;
  const patch: Record<string, unknown> = {};

  if (position.is_system) {
    // System positions: only permissions may be updated
    if (body.name !== undefined || body.base_tier !== undefined || body.slug !== undefined) {
      return apiValidationError({
        is_system: ["System positions cannot have their name, base_tier, or slug changed"],
      });
    }
  } else {
    // Custom positions: allow name, base_tier, permissions
    if (body.name !== undefined) {
      patch.name = String(body.name).trim();
    }
    if (body.base_tier !== undefined) {
      const { valid, errors } = validate(body, {
        base_tier: [isIn(["admin", "member"])],
      });
      if (!valid) return apiValidationError(errors);
      patch.base_tier = body.base_tier;
    }
  }

  if (body.permissions !== undefined) {
    const permError = validatePositionPermissions(body.permissions);
    if (permError) return apiValidationError({ permissions: [permError] });
    patch.permissions = body.permissions;
  }

  // layer_id is org placement (not identity/permissions) — allowed for system positions too
  if (body.layer_id !== undefined) {
    if (body.layer_id === null) {
      patch.layer_id = null;
    } else {
      const { data: layer } = await db
        .from("org_layers")
        .select("id")
        .eq("id", body.layer_id)
        .maybeSingle();
      if (!layer) return apiValidationError({ layer_id: ["Layer not found in this tenant"] });
      patch.layer_id = body.layer_id;
    }
  }

  if (Object.keys(patch).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await db
    .from("positions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update position");
    return apiError("DB_ERROR", "Failed to update position", 500);
  }

  const updatedPosition = updated as unknown as Position;

  // Role re-sync: if base_tier or leadScope changed, update all holder roles
  const newBaseTier = (patch.base_tier ?? position.base_tier) as "owner" | "admin" | "member";
  const newPermissions = (patch.permissions ?? position.permissions) as PositionPermissions;
  const newLeadScope = newPermissions.leadScope;
  const oldLeadScope = position.permissions.leadScope;

  const baseTierChanged = patch.base_tier !== undefined && patch.base_tier !== position.base_tier;
  const leadScopeChanged = newLeadScope !== oldLeadScope;

  if (baseTierChanged || leadScopeChanged) {
    const newRole = deriveRole(newBaseTier, newLeadScope);
    const { error: syncError } = await db
      .from("tenant_users")
      .update({ role: newRole })
      .eq("position_id", id);

    if (syncError) {
      log.error({ error: syncError }, "Failed to re-sync role for position holders");
      // Non-fatal — position updated; log but don't roll back
    } else {
      log.info({ positionId: id, newRole }, "Re-synced role for all position holders");
    }
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "position.updated",
      entityType: "position",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "position.updated",
      entityType: "position",
      entityId: id,
      payload: { changes: Object.keys(patch) },
      requestId,
    }),
  ]);

  log.info({ positionId: id }, "Position updated");
  return apiSuccess(updatedPosition);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/positions/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: positionData } = await db
    .from("positions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!positionData) return apiNotFound("Position");

  const position = positionData as unknown as Position;

  if (position.is_system) {
    return apiConflict("System positions cannot be deleted");
  }

  // Check for members with this position
  const { data: holders } = await db
    .raw()
    .from("tenant_users")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("position_id", id);

  const holderCount = (holders ?? []).length;
  if (holderCount > 0) {
    return apiConflict(`Reassign ${holderCount} member${holderCount !== 1 ? "s" : ""} before deleting this position`);
  }

  const { error } = await db
    .from("positions")
    .delete()
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete position");
    return apiError("DB_ERROR", "Failed to delete position", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "position.deleted",
      entityType: "position",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "position.deleted",
      entityType: "position",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ positionId: id }, "Position deleted");
  return apiSuccess({ id, deleted: true });
}
