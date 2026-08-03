import { NextRequest } from "next/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// PATCH /api/v1/settings/organization — save org name/slug/brand color + a form's
// redirect_url (admin-only). Was a direct browser write via the user-context client
// (settings-form.tsx); moved server-side because that client loses table access
// under the role-scoping revoke (Phase A §2d).
export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/settings/organization" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: {
    name?: string;
    primaryColor?: string;
    slug?: string;
    formConfigId?: string;
    redirectUrl?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const errors: Record<string, string[]> = {};
  if (body.name !== undefined && !body.name.trim()) errors.name = ["Name is required"];
  if (body.slug !== undefined && !SLUG_REGEX.test(body.slug)) {
    errors.slug = ["Slug must contain only lowercase letters, numbers, and hyphens"];
  }
  if (Object.keys(errors).length > 0) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const updateData: { name?: string; primary_color?: string; slug?: string } = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.primaryColor !== undefined) updateData.primary_color = body.primaryColor;
  if (body.slug !== undefined) updateData.slug = body.slug;

  if (Object.keys(updateData).length > 0) {
    // tenants has no tenant_id column (it IS the tenant, keyed by id) — scopedClient's
    // auto-injected tenant_id filter would 42703 on this table, so use raw() + an
    // explicit .eq("id", ...) instead, same as check-slug/route.ts's tenants lookup.
    const { error: tenantError } = await db
      .raw()
      .from("tenants")
      .update(updateData)
      .eq("id", auth.tenantId);

    if (tenantError) {
      if (tenantError.code === "23505") {
        return apiValidationError({ slug: ["This slug is already taken"] });
      }
      log.error({ err: tenantError }, "Failed to save tenant settings");
      return apiServiceUnavailable("Failed to save tenant settings");
    }
  }

  if (body.formConfigId) {
    const { error: formError } = await db
      .from("form_configs")
      .update({ redirect_url: body.redirectUrl || null })
      .eq("id", body.formConfigId);

    if (formError) {
      log.error({ err: formError }, "Failed to save form redirect URL");
      return apiServiceUnavailable("Failed to save form redirect URL");
    }
  }

  log.info({ tenantId: auth.tenantId }, "Organization settings saved");
  return apiSuccess({ saved: true });
}
