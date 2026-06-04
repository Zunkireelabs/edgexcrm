import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/utm-links/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.FORM_BUILDER)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("utm_links")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("UTM link");

  const { error } = await db.from("utm_links").delete().eq("id", id);

  if (error) {
    log.error({ err: error }, "Failed to delete utm_link");
    return apiError("DB_ERROR", "Failed to delete UTM link", 500);
  }

  log.info({ linkId: id }, "UTM link deleted");
  return apiSuccess({ deleted: true });
}
