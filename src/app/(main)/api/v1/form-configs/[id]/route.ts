import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
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
import { validateFormConfig } from "@/industries/education-consultancy/features/form-builder/lib/validation";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { FormStep, FormBranding, FormAttribution } from "@/types/database";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.FORM_BUILDER)) return apiForbidden();

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("form_configs")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (error || !data) return apiNotFound("Form config");

  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/form-configs/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.FORM_BUILDER)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const supabase = await createServiceClient();

  // Verify ownership
  const { data: existing } = await supabase
    .from("form_configs")
    .select("id, slug")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Form config");

  // If steps are being updated, auto-fix field names and validate
  if (body.steps) {
    const steps = (body.steps as FormStep[]).map((step) => ({
      ...step,
      fields: step.fields.map((field) => ({
        ...field,
        // Auto-fix: convert hyphens to underscores in field names
        name: field.name.replace(/-/g, "_"),
      })),
    }));
    body.steps = steps;
    const configErrors = validateFormConfig({
      name: String(body.name ?? "placeholder"),
      slug: String(body.slug ?? existing.slug),
      steps,
    });
    const stepErrors = configErrors.filter((e) => e.field.startsWith("steps"));
    if (stepErrors.length > 0) {
      const errorMap: Record<string, string[]> = {};
      stepErrors.forEach((e) => { errorMap[e.field] = [e.message]; });
      return apiValidationError(errorMap);
    }
  }

  // Check slug uniqueness if slug is being changed
  if (body.slug && body.slug !== existing.slug) {
    const slug = String(body.slug);
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return apiValidationError({ slug: ["Slug can only contain lowercase letters, numbers, and hyphens"] });
    }
    const { data: slugConflict } = await supabase
      .from("form_configs")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", slug)
      .neq("id", id)
      .maybeSingle();

    if (slugConflict) {
      return apiValidationError({ slug: ["This slug is already in use"] });
    }
  }

  // Build update payload — only include fields that were provided
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) updatePayload.name = String(body.name).trim();
  if (body.slug !== undefined) updatePayload.slug = String(body.slug).trim();
  if (body.is_active !== undefined) updatePayload.is_active = Boolean(body.is_active);
  if (body.steps !== undefined) updatePayload.steps = body.steps;
  if (body.branding !== undefined) updatePayload.branding = body.branding as FormBranding;
  if (body.redirect_url !== undefined) updatePayload.redirect_url = body.redirect_url ?? null;
  if (body.attribution !== undefined) {
    // Normalize: only persist the 3 known keys, coerce to string|null, skip empties
    const raw = (body.attribution ?? {}) as Record<string, unknown>;
    const normalized: FormAttribution = {};
    for (const key of ["default_source", "default_medium", "default_campaign"] as const) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) normalized[key] = v.trim();
      else if (v === null || v === undefined || v === "") normalized[key] = null;
    }
    updatePayload.attribution = normalized;
  }

  const { data: updated, error } = await supabase
    .from("form_configs")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update form config");
    return apiError("DB_ERROR", "Failed to update form", 500);
  }

  log.info({ formId: id }, "Form config updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/form-configs/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.FORM_BUILDER)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("form_configs")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Form config");

  const { error } = await supabase
    .from("form_configs")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    log.error({ error }, "Failed to delete form config");
    return apiError("DB_ERROR", "Failed to delete form", 500);
  }

  log.info({ formId: id }, "Form config deleted");
  return apiSuccess({ deleted: true });
}
