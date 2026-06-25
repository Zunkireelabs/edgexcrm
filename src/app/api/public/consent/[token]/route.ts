import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { emitEvent } from "@/lib/api/audit";
import { generateConsentPdf } from "@/lib/consent/pdf";

interface RouteContext {
  params: Promise<{ token: string }>;
}

async function lookupToken(supabase: Awaited<ReturnType<typeof createServiceClient>>, token: string) {
  const { data, error } = await supabase
    .from("lead_consents")
    .select("id, tenant_id, lead_id, status, body_snapshot, template_version, signed_at, link_expires_at, method")
    .eq("token", token)
    .is("deleted_at", null)
    .single();
  return { data, error };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: `/api/public/consent/${token.slice(0, 8)}` });

  const supabase = await createServiceClient();
  const { data, error } = await lookupToken(supabase, token);

  if (error || !data) {
    log.info({ token: token.slice(0, 8) }, "Token not found");
    return apiSuccess({ valid: false, reason: "This consent link is invalid or has been revoked." });
  }

  const row = data as {
    id: string;
    tenant_id: string;
    lead_id: string;
    status: string;
    body_snapshot: string | null;
    template_version: number | null;
    signed_at: string | null;
    link_expires_at: string | null;
    method: string | null;
  };

  if (row.status === "signed") {
    return apiSuccess({ valid: false, reason: "This consent has already been signed." });
  }

  if (row.link_expires_at && new Date(row.link_expires_at) < new Date()) {
    return apiSuccess({ valid: false, reason: "This consent link has expired. Please ask your consultant to resend it." });
  }

  // Fetch tenant branding + consent template settings
  const [tenantRes, tplRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, logo_url")
      .eq("id", row.tenant_id)
      .single(),
    supabase
      .from("consent_templates")
      .select("require_drawn_signature, title")
      .eq("tenant_id", row.tenant_id)
      .single(),
  ]);

  const tenant = tenantRes.data as { name: string; logo_url: string | null } | null;
  const tpl = tplRes.data as { require_drawn_signature: boolean; title: string } | null;

  return apiSuccess({
    valid: true,
    tenant: tenant ?? { name: "Your Consultant", logo_url: null },
    tenant_id: row.tenant_id,
    title: tpl?.title ?? "Student Consent & Authorization",
    body_snapshot: row.body_snapshot ?? "",
    require_drawn_signature: tpl?.require_drawn_signature ?? false,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/public/consent/${token.slice(0, 8)}` });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent");

  const supabase = await createServiceClient();
  const { data, error } = await lookupToken(supabase, token);

  if (error || !data) {
    return apiError("INVALID_TOKEN", "This consent link is invalid or has been revoked.", 400);
  }

  const row = data as {
    id: string;
    tenant_id: string;
    lead_id: string;
    status: string;
    body_snapshot: string | null;
    template_version: number | null;
    signed_at: string | null;
    link_expires_at: string | null;
  };

  if (row.status === "signed") {
    return apiError("ALREADY_SIGNED", "This consent has already been signed.", 409);
  }

  if (row.link_expires_at && new Date(row.link_expires_at) < new Date()) {
    return apiError("LINK_EXPIRED", "This consent link has expired. Please ask your consultant to resend it.", 410);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (!body.agreed) {
    return apiError("NOT_AGREED", "You must agree to the consent document.", 400);
  }
  if (!body.signer_name || !String(body.signer_name).trim()) {
    return apiError("MISSING_NAME", "Full name is required.", 400);
  }

  // Check if drawn signature required
  const { data: tpl } = await supabase
    .from("consent_templates")
    .select("require_drawn_signature")
    .eq("tenant_id", row.tenant_id)
    .single();

  const requireDrawn = (tpl as { require_drawn_signature: boolean } | null)?.require_drawn_signature ?? false;
  if (requireDrawn && !body.signature_image_url) {
    return apiError("SIGNATURE_REQUIRED", "A drawn signature is required.", 400);
  }

  const signedAt = new Date().toISOString();
  const signerName = String(body.signer_name).trim();
  const signatureImageUrl = body.signature_image_url ? String(body.signature_image_url) : null;

  const update: Record<string, unknown> = {
    status: "signed",
    method: "esign",
    signed_at: signedAt,
    signer_name: signerName,
    signature_type: body.signature_type === "drawn" ? "drawn" : "typed",
    signature_value: body.signature_value ? String(body.signature_value) : null,
    ip_address: ip,
  };
  if (signatureImageUrl) update.signature_image_url = signatureImageUrl;

  const { error: updateError } = await supabase
    .from("lead_consents")
    .update(update)
    .eq("id", row.id);

  if (updateError) {
    log.error({ error: updateError }, "Failed to record e-sign");
    return apiError("DB_ERROR", "Failed to record signature.", 500);
  }

  await emitEvent({
    tenantId: row.tenant_id,
    type: "consent.signed",
    entityType: "lead_consent",
    entityId: row.id,
    requestId,
    payload: { lead_id: row.lead_id, method: "esign" },
  });

  // Best-effort: generate the permanent signed PDF (filled consent text +
  // signature image + audit block) and store it. The consent is already
  // recorded as signed above, so a PDF failure never blocks the student.
  try {
    const consentBody = row.body_snapshot ?? "";
    const textHash = createHash("sha256").update(consentBody, "utf8").digest("hex");

    const [tenantRes, tplRes] = await Promise.all([
      supabase.from("tenants").select("name").eq("id", row.tenant_id).single(),
      supabase.from("consent_templates").select("title").eq("tenant_id", row.tenant_id).single(),
    ]);
    const organization = (tenantRes.data as { name: string } | null)?.name ?? "Your Consultant";
    const title = (tplRes.data as { title: string } | null)?.title ?? "Student Consent & Authorization";

    const signature = await loadSignatureImage(supabase, signatureImageUrl);

    const pdfBytes = await generateConsentPdf({
      title,
      body: consentBody,
      organization,
      signerName,
      signedAt,
      ipAddress: ip,
      userAgent,
      textHash,
      consentVersion: row.template_version,
      signature,
    });

    const pdfPath = `${row.tenant_id}/consent/${row.id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("lead-documents")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from("lead-documents").getPublicUrl(pdfPath);
    await supabase
      .from("lead_consents")
      .update({ document_url: pub.publicUrl })
      .eq("id", row.id);
  } catch (pdfErr) {
    log.error({ err: pdfErr, consentId: row.id }, "Failed to generate consent PDF (signature still recorded)");
  }

  log.info({ consentId: row.id }, "Consent e-signed");
  return apiSuccess({ signed: true });
}

/**
 * Download the drawn-signature PNG from the lead-documents bucket so it can be
 * embedded in the PDF. Derives the storage path from the stored public URL.
 */
async function loadSignatureImage(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  imageUrl: string | null,
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!imageUrl) return null;
  const marker = "/lead-documents/";
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(imageUrl.slice(idx + marker.length).split("?")[0]);

  const { data, error } = await supabase.storage.from("lead-documents").download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const type: "png" | "jpg" = path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg") ? "jpg" : "png";
  return { bytes, type };
}
