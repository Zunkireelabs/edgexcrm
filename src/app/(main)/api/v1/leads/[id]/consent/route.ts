import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, requireLeadBranchAccess, getClientIp } from "@/lib/api/auth";
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
import { prepareConsentBody, buildConsentMergeData } from "@/lib/consent/merge";
import { getLeadCountry } from "@/lib/leads/lead-location";
import { resolveConsentStatus, type ConsentRecordRow } from "@/lib/consent/resolve-status";
import { touchLeadUpdatedAt } from "@/lib/leads/touch-updated-at";
import { loadConsentReadiness, extractTemplatePlaceholders, CONSENT_PROFILE_COLUMNS, type ConsentProfile } from "@/lib/consent/readiness";
import { consentProfileIncompleteMessage } from "@/lib/blocking-notice";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Consent e-sign is shared by education (Student Consent, exposed via the
// APPLICATION_TRACKING feature) and every Offerings-industry tenant —
// real_estate, home_moving (Subscription Agreement — no separate feature;
// investors ride the leads spine). Additive gate: education access is
// unchanged.
function consentAccessAllowed(industryId: string | null): boolean {
  return (
    getFeatureAccess(industryId, FEATURES.APPLICATION_TRACKING) ||
    getFeatureAccess(industryId, FEATURES.OFFERINGS)
  );
}

// A lead that has already signed must never get a second, UNSIGNED consent record. A newer
// "sent" row next to the signed one used to make the consent card report "not signed" and
// block Applications, even though the lead page and the applications APIs count the signed row.
async function hasSignedConsent(db: Awaited<ReturnType<typeof scopedClient>>, leadId: string): Promise<boolean> {
  const { data } = await db
    .from("lead_consents")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "signed")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// Migration 254 allows at most one active unsigned consent per lead. When two sends race, the
// loser's insert fails with a unique violation; that is "someone just did this", not a server error.
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

const COUNSELOR_PLACEHOLDERS = ["counselor_name", "assign_name"];

type CounselorLookup =
  | { used: false }
  | { used: true; name: string; failed: false }
  | { used: true; name: ""; failed: boolean };

// Display name of the lead's assigned counselor, for {{counselor_name}} / {{assign_name}}. Same name
// source as the rest of the app (auth user_metadata name / full_name), falling back to their email.
// Only looked up when the template actually uses the placeholder (parsed once, here). Never throws:
// `failed` separates "the auth service errored" (retry later) from "the assignee has no usable name"
// (assign someone else), so an outage is never reported as an incomplete profile.
async function resolveCounselor(
  log: ReturnType<typeof createRequestLogger>,
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  assignedTo: string | null,
  templateBody: string | null | undefined,
): Promise<CounselorLookup> {
  if (!extractTemplatePlaceholders(templateBody).some((p) => COUNSELOR_PLACEHOLDERS.includes(p))) return { used: false };
  if (!assignedTo) return { used: true, name: "", failed: false };
  try {
    const { data, error } = await supabase.auth.admin.getUserById(assignedTo);
    if (error) throw error;
    const user = data?.user;
    const meta = (user?.user_metadata ?? {}) as { name?: string; full_name?: string };
    const name = (meta.name || meta.full_name || user?.email || "").trim();
    if (!name) log.warn({ assignedTo }, "consent: assigned counselor has no name or email");
    return { used: true, name, failed: false } as CounselorLookup;
  } catch (err) {
    log.error({ err, assignedTo }, "consent: could not look up the assigned counselor's name");
    return { used: true, name: "", failed: true };
  }
}

// The profile-readiness gate already refuses a lead with NO assignee. This catches what it can't see:
// an assignee whose name can't be resolved (deleted auth user) or an auth-service outage. Runs before
// the previous unsigned consent is replaced so a refusal leaves the existing link untouched.
function counselorRefusal(lookup: CounselorLookup, overrideRequested: boolean, industryId: string | null) {
  if (!lookup.used || lookup.name || overrideRequested || industryId !== "education_consultancy") return null;
  if (lookup.failed) {
    return apiError("COUNSELOR_LOOKUP_FAILED", "Couldn't look up the assigned counselor right now. Please try again in a moment.", 503);
  }
  return apiError(
    "PROFILE_INCOMPLETE_FOR_CONSENT",
    consentProfileIncompleteMessage(["Assigned Counselor"]),
    422,
    { missing: ["Assigned Counselor"] },
  );
}

function consentInProgress() {
  return apiError("CONSENT_IN_PROGRESS", "A consent request for this lead was just created. Please refresh and try again.", 409);
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  // Consent e-sign is shared by education (Student Consent, gated on
  // APPLICATION_TRACKING) and real_estate (Subscription Agreement). Additive
  // widening — education access is unchanged.
  if (!consentAccessAllowed(auth.industryId)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead belongs to tenant (with the profile columns, so the readiness check below needs no re-read)
  const { data: lead } = await supabase
    .from("leads")
    .select(`id, assigned_to, branch_id, ${CONSENT_PROFILE_COLUMNS}`)
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
    .select("is_active, body")
    .maybeSingle();

  const template = tpl as { is_active: boolean; body: string | null } | null;
  const consentEnabled = template?.is_active === true;

  // Every non-deleted consent row for this lead, newest first. The status is resolved by the same
  // "any signed record counts" rule the lead page and applications APIs use (see resolve-status.ts).
  // A lead only ever has a handful of rows (a resend soft-deletes the previous unsigned one); the
  // cap is a safety net, not a real limit.
  const { data: records } = await db
    .from("lead_consents")
    .select("id, status, method, token, signer_name, signed_at, document_url, link_expires_at, sent_at, sent_via")
    .eq("lead_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const { status, record: consentRecord } = resolveConsentStatus((records ?? []) as unknown as ConsentRecordRow[]);
  const link = status === "sent" && consentRecord?.token ? `${APP_URL}/consent/${consentRecord.token}` : null;

  // Education only: is the profile complete enough to generate a consent document? (null = not applicable)
  const readiness =
    auth.industryId === "education_consultancy" && consentEnabled
      ? await loadConsentReadiness(supabase, auth.tenantId, id, {
          template,
          profile: lead as unknown as ConsentProfile,
        })
      : null;

  return apiSuccess({
    consent_enabled: consentEnabled,
    status,
    record: consentRecord,
    link,
    readiness,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/consent` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!consentAccessAllowed(auth.industryId)) return apiForbidden();
  if (!canManageApplications(auth.permissions)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select(`id, assigned_to, branch_id, last_name, ${CONSENT_PROFILE_COLUMNS}`)
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
    phone: string | null;
    city: string | null;
    country: string | null;
    nationality: string | null;
    passport_number: string | null;
    full_address: string | null;
    father_name: string | null;
    mother_name: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    date_of_birth: string | null;
    guardian_phone: string | null;
    guardian_email: string | null;
    guardian_relationship: string | null;
    guardian_name: string | null;
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
  if (!action || !["send", "record_manual", "send_in_person"].includes(action)) {
    return apiError("INVALID_ACTION", "action must be 'send', 'record_manual', or 'send_in_person'", 400);
  }

  const db = await scopedClient(auth);

  // Education: a half-filled profile makes a consent document with blank details, so all three actions
  // (send / Sign here now / Record manually) wait until the profile is complete. Owner/admin may send
  // anyway after confirming — logged below. An already-signed lead skips this so ALREADY_SIGNED wins.
  if (auth.industryId === "education_consultancy") {
    const overrideRequested = body.override_profile_check === true;
    if (overrideRequested && !requireAdmin(auth)) return apiForbidden();
    if (!(await hasSignedConsent(db, id))) {
      const readiness = await loadConsentReadiness(supabase, auth.tenantId, id, {
        profile: lead as unknown as ConsentProfile,
      });
      if (readiness && !readiness.ready) {
        if (!overrideRequested) {
          return apiError(
            "PROFILE_INCOMPLETE_FOR_CONSENT",
            consentProfileIncompleteMessage(readiness.missing),
            422,
            { missing: readiness.missing },
          );
        }
        await createAuditLog({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: "consent.profile_check_overridden",
          entityType: "lead",
          entityId: id,
          changes: { consent_action: { old: null, new: action }, missing: { old: null, new: readiness.missing } },
          requestId,
        });
      }
    }
  }

  if (action === "send") {
    // deliver: "email" (default — today's behaviour: email the link when the lead has an email) or
    // "none" (create the signing link only, so staff can hand it over themselves, e.g. on WhatsApp).
    const deliver = body.deliver === undefined ? "email" : body.deliver;
    if (deliver !== "email" && deliver !== "none") {
      return apiError("INVALID_DELIVER", "deliver must be 'email' or 'none'", 400);
    }

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

    if (await hasSignedConsent(db, id)) {
      return apiError("ALREADY_SIGNED", "Consent is already signed for this lead", 409);
    }

    // Resolve the counselor BEFORE the previous unsigned consent is replaced below, so a failure
    // here leaves the existing link untouched.
    const counselor = await resolveCounselor(log, supabase, leadRow.assigned_to, tplRow.body);
    const counselorBlocked = counselorRefusal(counselor, body.override_profile_check === true, auth.industryId);
    if (counselorBlocked) return counselorBlocked;
    const counselorName = counselor.used ? counselor.name : "";

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
    const leadEmail = deliver === "email" ? leadRow.email : null;
    const sentVia = leadEmail ? "email" : "link";

    // Resolve the org name, then fill the dynamic template with this student's
    // data so the frozen body_snapshot is personalized (same template, every
    // student). The snapshot is what the student signs and what the PDF renders.
    const orgRes = await supabase
      .from("tenants")
      .select("name")
      .eq("id", auth.tenantId)
      .single();
    const organization = (orgRes.data as { name: string } | null)?.name ?? "Your Consultant";
    const prepared = prepareConsentBody(
      tplRow.body ?? "",
      buildConsentMergeData({
        firstName: leadRow.first_name,
        lastName: leadRow.last_name,
        email: leadRow.email,
        phone: leadRow.phone,
        city: leadRow.city,
        country: getLeadCountry(leadRow),
        nationality: leadRow.nationality,
        passportNumber: leadRow.passport_number,
        fullAddress: leadRow.full_address,
        fatherName: leadRow.father_name,
        motherName: leadRow.mother_name,
        emergencyContactName: leadRow.emergency_contact_name,
        emergencyContactPhone: leadRow.emergency_contact_phone,
        dateOfBirth: leadRow.date_of_birth,
        guardianPhone: leadRow.guardian_phone,
        guardianEmail: leadRow.guardian_email,
        guardianRelationship: leadRow.guardian_relationship,
        guardianName: leadRow.guardian_name,
        counselorName,
        organization,
        consentVersion: tplRow.version,
      }),
    );

    const { data: newRecord, error: insertError } = await db
      .from("lead_consents")
      .insert({
        tenant_id: auth.tenantId,
        lead_id: id,
        status: "sent",
        token,
        body_snapshot: prepared.body,
        missing_fields: prepared.missingFields,
        template_version: tplRow.version,
        sent_at: new Date().toISOString(),
        sent_via: sentVia,
        link_expires_at: expiresAt,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (isUniqueViolation(insertError)) return consentInProgress();
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
        tenantId: auth.tenantId,
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
      touchLeadUpdatedAt(supabase, auth.tenantId, id),
    ]);

    log.info({ consentId: (newRecord as { id: string }).id }, "Consent sent");
    return apiSuccess({ ...newRecord, link: consentLink }, 201);
  }

  if (action === "send_in_person") {
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

    if (await hasSignedConsent(db, id)) {
      return apiError("ALREADY_SIGNED", "Consent is already signed for this lead", 409);
    }

    // Resolve the counselor BEFORE the previous unsigned consent is replaced below, so a failure
    // here leaves the existing link untouched.
    const counselor = await resolveCounselor(log, supabase, leadRow.assigned_to, tplRow.body);
    const counselorBlocked = counselorRefusal(counselor, body.override_profile_check === true, auth.industryId);
    if (counselorBlocked) return counselorBlocked;
    const counselorName = counselor.used ? counselor.name : "";

    await db
      .from("lead_consents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("lead_id", id)
      .eq("tenant_id", auth.tenantId)
      .neq("status", "signed")
      .is("deleted_at", null);

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Personalize the frozen body_snapshot with this student's data — same
    // pattern as the "send" action, so the in-person signer (and the rendered
    // PDF) sees a filled document, not raw {{merge_tags}}.
    const orgRes = await supabase
      .from("tenants")
      .select("name")
      .eq("id", auth.tenantId)
      .single();
    const organization = (orgRes.data as { name: string } | null)?.name ?? "Your Consultant";
    const prepared = prepareConsentBody(
      tplRow.body ?? "",
      buildConsentMergeData({
        firstName: leadRow.first_name,
        lastName: leadRow.last_name,
        email: leadRow.email,
        phone: leadRow.phone,
        city: leadRow.city,
        country: getLeadCountry(leadRow),
        nationality: leadRow.nationality,
        passportNumber: leadRow.passport_number,
        fullAddress: leadRow.full_address,
        fatherName: leadRow.father_name,
        motherName: leadRow.mother_name,
        emergencyContactName: leadRow.emergency_contact_name,
        emergencyContactPhone: leadRow.emergency_contact_phone,
        dateOfBirth: leadRow.date_of_birth,
        guardianPhone: leadRow.guardian_phone,
        guardianEmail: leadRow.guardian_email,
        guardianRelationship: leadRow.guardian_relationship,
        guardianName: leadRow.guardian_name,
        counselorName,
        organization,
        consentVersion: tplRow.version,
      }),
    );

    const { data: newRecord, error: insertError } = await db
      .from("lead_consents")
      .insert({
        tenant_id: auth.tenantId,
        lead_id: id,
        status: "sent",
        token,
        body_snapshot: prepared.body,
        missing_fields: prepared.missingFields,
        template_version: tplRow.version,
        sent_at: new Date().toISOString(),
        sent_via: "in_person",
        link_expires_at: expiresAt,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (isUniqueViolation(insertError)) return consentInProgress();
    if (insertError || !newRecord) {
      log.error({ error: insertError }, "Failed to create in-person consent record");
      return apiError("DB_ERROR", "Failed to create consent record", 500);
    }

    const consentLink = `${APP_URL}/consent/${token}`;

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
        payload: { lead_id: id, sent_via: "in_person" },
      }),
      touchLeadUpdatedAt(supabase, auth.tenantId, id),
    ]);

    log.info({ consentId: (newRecord as { id: string }).id }, "In-person consent session started");
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
    touchLeadUpdatedAt(supabase, auth.tenantId, id),
  ]);

  log.info({ consentId: manualRow.id }, "Manual consent recorded");
  return apiSuccess(manualRecord, 201);
}
