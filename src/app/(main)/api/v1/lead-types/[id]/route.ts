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

const EDUCATION = "education_consultancy";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/lead-types/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.industryId !== EDUCATION) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const db = await scopedClient(auth);

  // Confirm row exists in this tenant
  const { data: existing } = await db.from("lead_types").select("*").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound();

  const patch: Record<string, unknown> = {};
  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) return apiValidationError({ label: ["Label cannot be empty"] });
    patch.label = label;
  }
  if (typeof body.sort_order === "number") {
    patch.sort_order = body.sort_order;
  }
  if (typeof body.is_default === "boolean" && body.is_default) {
    // Clear other defaults first; scoped update() auto-applies tenant filter, chain neq() to exclude current row
    const { error: clearErr } = await db
      .from("lead_types")
      .update({ is_default: false })
      .neq("id", id);
    if (clearErr) {
      log.error({ clearErr }, "Failed to clear other defaults");
      return apiError("DB_ERROR", "Failed to set default", 500);
    }
    patch.is_default = true;
  }

  if (Object.keys(patch).length === 0) return apiValidationError({ body: ["No fields to update"] });

  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await db
    .from("lead_types")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update lead type");
    return apiError("DB_ERROR", "Failed to update lead type", 500);
  }
  return apiSuccess(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/lead-types/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.industryId !== EDUCATION) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existingRaw } = await db.from("lead_types").select("*").eq("id", id).maybeSingle();
  if (!existingRaw) return apiNotFound();
  const existing = existingRaw as unknown as { id: string; slug: string; label: string; is_default: boolean };

  // Block delete if any non-deleted lead in this tenant has this slug in their tags array.
  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .contains("tags", [existing.slug])
    .is("deleted_at", null);

  if ((count ?? 0) > 0) {
    return apiError(
      "IN_USE",
      `Cannot delete "${existing.label}" — ${count} lead${count === 1 ? "" : "s"} still use this type. Reassign them first.`,
      409,
    );
  }

  const { error } = await db.from("lead_types").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete lead type");
    return apiError("DB_ERROR", "Failed to delete lead type", 500);
  }

  return apiSuccess({ deleted: true });
}
