import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess, getClientIp } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { shouldRestrictToSelf, canManageApplications } from "@/lib/api/permissions";
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
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { sendConsentEmail } from "@/lib/email/send-consent";
import { APP_URL } from "@/lib/email";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id, email")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null; email: string | null };

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      leadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  const db = await scopedClient(auth);

  // Check if tenant has an active consent template
  const { data: tpl } = await db
    .from("consent_templates")
    .select("is_active")
    .maybeSingle();

  const consentEnabled = (tpl as { is_active: boolean } | null)?.is_active === true;

  // Fetch latest non-deleted consent record for this lead
  const { data: record } = await db
    .from("lead_consents")
    .select("id, status, method, token, signer_name, signed_at, document_url, link_expires_at, sent_at, sent_via")
    .eq("lead_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const consentRecord = record as {
    id: string;
    status: string;
    method: string | null;
    token: string | null;
    signer_name: string | null;
    signed_at: string | null;
    document_url: string | null;
    link_expires_at: string | null;
    sent_at: string | null;
    sent_via: string | null;
  } | null;

  // Compute effective status
  let status: "none" | "sent" | "signed" | "expired" = "none";
  let link: string | null = null;

  if (consentRecord) {
    if (consentRecord.status === "signed") {
      status = "signed";
    } else if (
      consentRecord.status === "sent" &&
      consentRecord.link_expires_at &&
      new Date(consentRecord.link_expires_at) < new Date()
    ) {
      status = "expired";
    } else if (consentRecord.status === "sent") {
      status = "sent";
      if (consentRecord.token) {
        link = `${APP_URL}/consent/${consentRecord.token}`;
      }
    }
  }

  return apiSuccess({
    consent_enabled: consentEnabled,
    status,
    record: consentRecord,
    link,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/consent` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!canManageApplications(auth.permissions)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id, email, first_name, last_name")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as {
    id: string;
    assigned_to: string | null;
    branch_id: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  };

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      leadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const action = body.action as string;
  if (!action || !["send", "record_manual"].includes(action)) {
    return apiError("INVALID_ACTION", "action must be 'send' or 'record_manual'", 400);
  }

  const db = await scopedClient(auth);

  if (action === "send") {
    // Require an active consent template
    const { data: tpl } = await db
      .from("consent_templates")
      .select("id, body, version, link_expiry_days, title, is_active")
      .maybeSingle();

    const tplRow = tpl as {
      id: string;
      body: string;
      version: number;
      link_expiry_days: number;
      title: string;
      is_active: boolean;
    } | null;

    if (!tplRow?.is_active) {
      return apiError("NO_TEMPLATE", "Configure consent in Settings first", 400);
    }

    // Soft-delete any prior unsigned consent for this lead
    await db
      .from("lead_consents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("lead_id", id)
      .eq("tenant_id", auth.tenantId)
      .neq("status", "signed")
      .is("deleted_at", null);

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + tplRow.link_expiry_days * 24 * 60 * 60 * 1000).toISOString();
    const leadEmail = leadRow.email;
    const sentVia = leadEmail ? "email" : "link";

    const { data: newRecord, error: insertError } = await db
      .from("lead_consents")
      .insert({
        tenant_id: auth.tenantId,
        lead_id: id,
        status: "sent",
        token,
        body_snapshot: tplRow.body,
        template_version: tplRow.version,
        sent_at: new Date().toISOString(),
        sent_via: sentVia,
        link_expires_at: expiresAt,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (insertError || !newRecord) {
      log.error({ error: insertError }, "Failed to create consent record");
      return apiError("DB_ERROR", "Failed to create consent record", 500);
    }

    const consentLink = `${APP_URL}/consent/${token}`;

    // Fire-and-forget email if lead has an email
    if (leadEmail) {
      const tenantRes = await supabase
        .from("tenants")
        .select("name, primary_color")
        .eq("id", auth.tenantId)
        .single();
      const tenantInfo = tenantRes.data as { name: string; primary_color: string | null } | null;

      sendConsentEmail({
        to: leadEmail,
        studentName: [leadRow.first_name, leadRow.last_name].filter(Boolean).join(" ") || "Student",
        tenantName: tenantInfo?.name ?? "Your Consultant",
        token,
        primaryColor: tenantInfo?.primary_color ?? undefined,
        expiryDays: tplRow.link_expiry_days,
      }).then((result) => {
        if (!result.success) log.error({ error: result.error }, "Failed to send consent email");
      }).catch((err) => {
        log.error({ err }, "Exception sending consent email");
      });
    }

    await Promise.all([
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "consent.sent",
        entityType: "lead_consent",
        entityId: (newRecord as { id: string }).id,
        requestId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: "consent.sent",
        entityType: "lead_consent",
        entityId: (newRecord as { id: string }).id,
        requestId,
        payload: { lead_id: id, sent_via: sentVia },
      }),
    ]);

    log.info({ consentId: (newRecord as { id: string }).id }, "Consent sent");
    return apiSuccess({ ...newRecord, link: consentLink }, 201);
  }

  // action === "record_manual"
  if (!body.signer_name || !body.document_url) {
    return apiError("MISSING_FIELDS", "signer_name and document_url are required", 400);
  }

  const { data: tpl } = await db
    .from("consent_templates")
    .select("body")
    .maybeSingle();

  const bodySnapshot = (tpl as { body: string } | null)?.body ?? "";
  const signedAt = body.signed_at ? String(body.signed_at) : new Date().toISOString();

  const { data: manualRecord, error: manualError } = await db
    .from("lead_consents")
    .insert({
      tenant_id: auth.tenantId,
      lead_id: id,
      status: "signed",
      method: "manual_upload",
      signer_name: String(body.signer_name),
      document_url: String(body.document_url),
      signed_at: signedAt,
      body_snapshot: bodySnapshot,
      created_by: auth.userId,
      ip_address: ip,
    })
    .select()
    .single();

  if (manualError || !manualRecord) {
    log.error({ error: manualError }, "Failed to record manual consent");
    return apiError("DB_ERROR", "Failed to record manual consent", 500);
  }

  const manualRow = manualRecord as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "consent.signed",
      entityType: "lead_consent",
      entityId: manualRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "consent.signed",
      entityType: "lead_consent",
      entityId: manualRow.id,
      requestId,
      payload: { lead_id: id, method: "manual_upload" },
    }),
  ]);

  log.info({ consentId: manualRow.id }, "Manual consent recorded");
  return apiSuccess(manualRecord, 201);
}
