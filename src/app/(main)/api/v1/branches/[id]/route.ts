import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import type { Branch } from "@/types/database";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/branches/${id}` });

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

  // Verify branch exists in this tenant
  const { data: existing } = await db.from("branches").select("id").eq("id", id).single();
  if (!existing) return apiNotFound("Branch");

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiValidationError({ name: ["Name cannot be empty"] });
    if (name.length > 120) return apiValidationError({ name: ["Name must be 120 characters or fewer"] });
    patch.name = name;
  }

  if (body.slug !== undefined) {
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!slug) return apiValidationError({ slug: ["Slug cannot be empty"] });
    patch.slug = slug;
  }

  if (body.sort_order !== undefined) {
    patch.sort_order = typeof body.sort_order === "number" ? body.sort_order : 0;
  }

  if (body.manager_user_id !== undefined) {
    patch.manager_user_id =
      body.manager_user_id === null
        ? null
        : typeof body.manager_user_id === "string" && UUID_REGEX.test(body.manager_user_id)
          ? body.manager_user_id
          : null;
  }

  if (Object.keys(patch).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data, error } = await db
    .from("branches")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ slug: ["A branch with this slug already exists"] });
    }
    log.error({ err: error }, "Failed to update branch");
    return apiServiceUnavailable("Failed to update branch");
  }

  log.info({ branchId: id }, "Branch updated");
  return apiSuccess(data as Branch);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/branches/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  // Verify branch exists in this tenant
  const { data: existing } = await db.from("branches").select("id").eq("id", id).single();
  if (!existing) return apiNotFound("Branch");

  // FKs on tenant_users.branch_id and leads.branch_id are ON DELETE SET NULL — no cascade needed
  const { error } = await db.from("branches").delete().eq("id", id);

  if (error) {
    log.error({ err: error }, "Failed to delete branch");
    return apiServiceUnavailable("Failed to delete branch");
  }

  log.info({ branchId: id }, "Branch deleted");
  return apiSuccess({ id, deleted: true });
}
