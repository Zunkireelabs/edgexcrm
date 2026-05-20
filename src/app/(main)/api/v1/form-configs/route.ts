import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { requireAdmin } from "@/lib/api/auth";
import { createRequestLogger } from "@/lib/logger";
import { slugify, validateFormConfig } from "@/features/form-builder/lib/validation";
import { getTemplateById } from "@/features/form-builder/templates";
import type { FormBranding } from "@/types/database";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("form_configs")
    .select("id, name, slug, is_active, created_at, updated_at, steps, branding, redirect_url")
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch form configs", 500);

  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/form-configs" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const name = String(body.name).trim();
  const templateId = body.template_id ? String(body.template_id) : null;
  const isMultiStep = body.is_multi_step === true;

  // Generate slug from name or use provided
  let slug = body.slug ? String(body.slug).trim() : slugify(name);
  if (!slug) slug = slugify(name);

  // Validate the slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return apiValidationError({ slug: ["Slug can only contain lowercase letters, numbers, and hyphens"] });
  }

  // Build steps and branding from template or defaults
  let steps: unknown[] = [];
  let branding: Partial<FormBranding> = {};

  if (templateId) {
    const template = getTemplateById(templateId);
    if (!template) {
      return apiError("INVALID_TEMPLATE", "Template not found", 400);
    }
    steps = template.steps;
    branding = {
      ...template.branding,
      primary_color: template.branding.primary_color ?? "#6366f1",
    };
  } else {
    steps = isMultiStep ? [{ title: "Step 1", fields: [] }, { title: "Step 2", fields: [] }] : [{ title: "Step 1", fields: [] }];
    branding = {
      title: name,
      primary_color: "#6366f1",
      button_text: "Submit",
      thank_you_title: "Thank you!",
      thank_you_message: "Your response has been submitted.",
    };
  }

  const supabase = await createServiceClient();

  // Check slug uniqueness within tenant
  const { data: existing } = await supabase
    .from("form_configs")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    // Append a suffix to make it unique
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const { data: created, error } = await supabase
    .from("form_configs")
    .insert({
      tenant_id: auth.tenantId,
      name,
      slug,
      is_active: true,
      steps,
      branding,
      redirect_url: body.redirect_url ? String(body.redirect_url) : null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create form config");
    return apiError("DB_ERROR", "Failed to create form", 500);
  }

  log.info({ formId: created.id }, "Form config created");
  return apiSuccess(created, 201);
}
