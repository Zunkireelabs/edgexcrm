import { type NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiNotFound, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.AFFILIATES)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { name?: string; email?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  const db = await scopedClient(auth);

  const { data: existing, error: fetchError } = await db
    .from("affiliates")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch affiliate", 500);
  if (!existing) return apiNotFound("Affiliate not found");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return apiValidationError({ name: ["Name cannot be empty"] });
    patch.name = name;
  }
  if (body.email !== undefined) {
    patch.email = body.email.trim() || null;
  }
  if (body.status !== undefined) {
    if (!["active", "inactive"].includes(body.status)) {
      return apiValidationError({ status: ["Status must be active or inactive"] });
    }
    patch.status = body.status;
  }

  const { data: updated, error: updateError } = await db
    .from("affiliates")
    .update(patch)
    .eq("id", id)
    .select("id, name, ref_code, email, status, created_at, updated_at")
    .single();

  if (updateError) return apiError("DB_ERROR", "Failed to update affiliate", 500);

  return apiSuccess(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.AFFILIATES)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing, error: fetchError } = await db
    .from("affiliates")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch affiliate", 500);
  if (!existing) return apiNotFound("Affiliate not found");

  const { error: deleteError } = await db
    .from("affiliates")
    .delete()
    .eq("id", id);

  if (deleteError) return apiError("DB_ERROR", "Failed to delete affiliate", 500);

  return apiSuccess({ deleted: true });
}
