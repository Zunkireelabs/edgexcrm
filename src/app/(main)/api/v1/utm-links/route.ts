import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { UtmLink } from "@/types/database";

type UtmLinkRow = Omit<UtmLink, "form_name"> & {
  form: { name: string } | null;
};

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/utm-links" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.FORM_BUILDER)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("utm_links")
    .select("*, form:form_configs(name)")
    .order("created_at", { ascending: false });

  if (error) {
    log.error({ err: error }, "Failed to list utm_links");
    return apiError("DB_ERROR", "Failed to list saved UTM links", 500);
  }

  const rows = (data ?? []) as unknown as UtmLinkRow[];
  const links: UtmLink[] = rows.map(({ form, ...row }) => ({
    ...row,
    form_name: form?.name ?? null,
  }));

  return apiSuccess({ links });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/utm-links" });

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

  const destinationUrl = typeof body.destination_url === "string" ? body.destination_url.trim() : "";
  const trackingUrl = typeof body.tracking_url === "string" ? body.tracking_url.trim() : "";

  if (!destinationUrl || !trackingUrl) {
    return apiValidationError({
      destination_url: !destinationUrl ? ["Destination URL is required"] : [],
      tracking_url: !trackingUrl ? ["Tracking URL is required"] : [],
    });
  }

  try {
    new URL(trackingUrl);
  } catch {
    return apiValidationError({ tracking_url: ["Must be a valid URL"] });
  }

  const formId = typeof body.form_id === "string" && body.form_id ? body.form_id : null;
  const utmSource = typeof body.utm_source === "string" && body.utm_source.trim() ? body.utm_source.trim() : null;
  const utmMedium = typeof body.utm_medium === "string" && body.utm_medium.trim() ? body.utm_medium.trim() : null;
  const utmCampaign = typeof body.utm_campaign === "string" && body.utm_campaign.trim() ? body.utm_campaign.trim() : null;

  const db = await scopedClient(auth);

  // If form_id is provided, verify it belongs to this tenant
  if (formId) {
    const { data: form } = await db
      .from("form_configs")
      .select("id")
      .eq("id", formId)
      .maybeSingle();
    if (!form) {
      return apiValidationError({ form_id: ["Form not found"] });
    }
  }

  const { data: inserted, error } = await db
    .from("utm_links")
    .insert({
      form_id: formId,
      destination_url: destinationUrl,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      tracking_url: trackingUrl,
      created_by: auth.userId,
    })
    .select("*, form:form_configs(name)")
    .single();

  if (error || !inserted) {
    log.error({ err: error }, "Failed to save utm_link");
    return apiError("DB_ERROR", "Failed to save UTM link", 500);
  }

  const { form, ...row } = inserted as unknown as UtmLinkRow;
  const link: UtmLink = { ...row, form_name: form?.name ?? null };

  log.info({ linkId: link.id }, "UTM link saved");
  return apiSuccess(link, 201);
}
