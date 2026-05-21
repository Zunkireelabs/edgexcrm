import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/form-configs/${id}/duplicate` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: source } = await supabase
    .from("form_configs")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!source) return apiNotFound("Form config");

  // Generate a unique slug for the copy
  const baseSlug = `${source.slug}-copy`;
  let slug = baseSlug;

  const { data: slugConflict } = await supabase
    .from("form_configs")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("slug", slug)
    .maybeSingle();

  if (slugConflict) {
    slug = `${baseSlug}-${Date.now().toString(36)}`;
  }

  const { data: created, error } = await supabase
    .from("form_configs")
    .insert({
      tenant_id: auth.tenantId,
      name: `${source.name} (Copy)`,
      slug,
      is_active: false, // Start inactive so admin can review before publishing
      steps: source.steps,
      branding: source.branding,
      redirect_url: source.redirect_url,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to duplicate form config");
    return apiError("DB_ERROR", "Failed to duplicate form", 500);
  }

  log.info({ sourceId: id, newId: created.id }, "Form config duplicated");
  return apiSuccess(created, 201);
}
