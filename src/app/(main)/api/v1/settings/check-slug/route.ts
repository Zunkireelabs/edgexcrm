import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_SLUG_LENGTH = 2;
const MAX_SLUG_LENGTH = 50;

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/settings/check-slug",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.toLowerCase().trim();

  if (!slug) {
    return apiValidationError({ slug: ["Slug is required"] });
  }

  if (slug.length < MIN_SLUG_LENGTH) {
    return apiValidationError({ slug: [`Slug must be at least ${MIN_SLUG_LENGTH} characters`] });
  }

  if (slug.length > MAX_SLUG_LENGTH) {
    return apiValidationError({ slug: [`Slug must be at most ${MAX_SLUG_LENGTH} characters`] });
  }

  if (!SLUG_REGEX.test(slug)) {
    return apiValidationError({
      slug: ["Slug must contain only lowercase letters, numbers, and hyphens"]
    });
  }

  const supabase = await createServiceClient();

  // Check if slug exists for any tenant OTHER than the current one
  const { data: existing, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .neq("id", auth.tenantId)
    .maybeSingle();

  if (error) {
    log.error({ err: error }, "Failed to check slug availability");
    return apiServiceUnavailable("Failed to check slug availability");
  }

  const available = !existing;

  log.info({ slug, available }, "Slug availability checked");

  return apiSuccess({ slug, available });
}
