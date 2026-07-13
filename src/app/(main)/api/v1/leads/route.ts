import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { getBranchIds } from "@/lib/supabase/queries";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import { leadQueryScope, canSeeNav, canAccessList, isSharedPoolList, resolveEffectiveBranch } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  apiSuccess,
  apiPaginated,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiRateLimited,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, isUUID, optionalMaxLength, isIn, isEmail } from "@/lib/api/validation";
import { PROSPECT_INDUSTRY_VALUES } from "@/industries/it-agency/leads/prospect-industries";
import { SALUTATION_VALUES } from "@/industries/it-agency/leads/salutations";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { checkRateLimit, FORM_SUBMIT_LIMIT } from "@/lib/api/rate-limit";
import { createRequestLogger } from "@/lib/logger";
import {
  upsertThreadNotification,
  getTenantAdminRecipients,
  NotificationTypes,
} from "@/lib/notifications";
import type { Lead, FormStep, FormConfig } from "@/types/database";
import { validateSubmissionAgainstForm } from "@/lib/leads/form-validation";
import { branchMemberIds, sharedBranchLeadIdsForAssignee, syncOriginMembership, unassignedCrossBranchLeadIds } from "@/lib/leads/branch-membership";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { addLeadCollaborator, collaboratorLeadIdsForUser } from "@/lib/leads/collaborators";
import {
  normalizeEmail,
  normalizePhone,
  resolveLeadIdentity,
  applyCanonicalUpdate,
  recordSubmission,
  recordDuplicateSuggestions,
  resolveFormName,
  emitSubmissionAudit,
  touchLastActivity,
} from "@/lib/leads/dedup";
import { resolveLeadPipelineAndStage } from "@/lib/leads/pipeline-resolution";
import { getPipelineLandingStage } from "@/lib/leads/pipeline-stage";
import { STAGE_TEAM_MAP } from "@/industries/education-consultancy/lead-assignment-by-stage";
import { processEmailForwardRules } from "@/lib/email/email-forward";
import { processFormAutoresponder } from "@/lib/email/form-autoresponder";
import { assignDisplayIds } from "@/lib/leads/assign-display-ids";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// CORS preflight
export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/leads",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canSeeNav(auth.permissions, "/leads")) return apiForbidden();

  log.info({ tenantId: auth.tenantId }, "Fetching leads");

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10))
  );
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  let assignedTo = searchParams.get("assigned_to");
  const includeConverted = searchParams.get("include_converted") === "1";
  const listSlug = searchParams.get("list");

  const supabase = await createServiceClient();

  // Resolve ?list=slug for lead-lists feature
  let resolvedListId: string | null = null;
  let archiveListIds: string[] = [];
  if (getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) {
    const { data: lists } = await supabase
      .from("lead_lists")
      .select("id, slug, is_archive, access")
      .eq("tenant_id", auth.tenantId);

    if (lists) {
      archiveListIds = lists.filter((l) => l.is_archive).map((l) => l.id);

      if (listSlug) {
        const targetList = lists.find((l) => l.slug === listSlug);
        if (!targetList) {
          log.info({ listSlug }, "List not found");
          return apiForbidden();
        }
        const accessible = canAccessList(
          auth.permissions,
          targetList.access as { mode: string; positionIds?: string[] },
          auth.positionId,
          targetList.id,
        );
        if (!accessible) return apiForbidden();
        resolvedListId = targetList.id;
      }
    }
  }

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null);

  if (!includeConverted) {
    query = query.is("converted_at", null);
  }

  // Exclude "other" tagged contacts — they live on the /contacts page, not in lead lists
  query = query.not("tags", "cs", '{"other"}');

  // Apply list filter
  if (resolvedListId) {
    query = query.eq("list_id", resolvedListId);
  } else if (archiveListIds.length > 0) {
    // Master view: exclude leads in archive lists
    query = query.or(`list_id.is.null,list_id.not.in.(${archiveListIds.join(",")})`);
  }

  // Scope enforcement: own (counselor) + team (branch manager, with §4.1 NULL-branch fallback)
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
  if (auth.branchId && isSharedPoolList(auth.permissions, resolvedListId)) {
    // This list is a branch-wide shared pool for an own-scope holder: show ALL branch leads,
    // not just their own. auth.branchMemberIds is empty for own-scope, so resolve explicitly.
    const memberIds = await branchMemberIds(supabase, auth.tenantId, auth.branchId);
    query = query.in("assigned_to", memberIds);
    assignedTo = null;
  } else if (scope.restrictToSelf) {
    // Inline column filter — avoids .in("id", 500+ uuids) which overflows Node/undici URL limits.
    // Widen to leads the user is a collaborator on (ever assigned) so handed-off leads stay visible.
    // Also widen to unassigned cross-branch leads matching the user's position route (e.g. Pre-qualified for Lead Callers).
    const poolSlug = auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
      ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
      : null;
    const [sharedIds, collabIds, poolIds] = await Promise.all([
      sharedBranchLeadIdsForAssignee(supabase, auth.tenantId, auth.userId),
      collaboratorLeadIdsForUser(supabase, auth.tenantId, auth.userId),
      poolSlug && auth.branchId
        ? unassignedCrossBranchLeadIds(supabase, auth.tenantId, auth.branchId, poolSlug)
        : Promise.resolve([]),
    ]);
    // Cap at 300 UUIDs — ~11 KB — to stay well under undici's 16 KB URL limit.
    const rawExtra = [...new Set([...sharedIds, ...collabIds, ...poolIds])];
    const extraIds = rawExtra.slice(0, 300);
    if (extraIds.length > 0) {
      query = query.or(`assigned_to.eq.${auth.userId},id.in.(${extraIds.join(",")})`);
    } else {
      query = query.eq("assigned_to", auth.userId);
    }
    assignedTo = null; // self-scoped users: ignore any client assignedTo param
  } else if (scope.branchId) {
    // Include leads assigned to branch members AND leads shared into this branch via lead_branches
    const { data: sharedRows } = await supabase
      .from("lead_branches")
      .select("lead_id")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", scope.branchId);
    const sharedLeadIds = (sharedRows ?? []).map((r: { lead_id: string }) => r.lead_id);
    if (auth.branchMemberIds.length > 0 && sharedLeadIds.length > 0) {
      query = query.or(`assigned_to.in.(${auth.branchMemberIds.join(",")}),id.in.(${sharedLeadIds.join(",")})`);
    } else if (sharedLeadIds.length > 0) {
      query = query.in("id", sharedLeadIds);
    } else {
      query = query.in("assigned_to", auth.branchMemberIds);
    }
  }

  // Admin branch focus filter (?branch_id= switcher) — honored ONLY for all-scope callers;
  // team/own users cannot widen or redirect their scope via this param.
  const adminBranchFilter = searchParams.get("branch_id");
  if (adminBranchFilter && auth.permissions.leadScope === "all") {
    const memberIds = await branchMemberIds(supabase, auth.tenantId, adminBranchFilter);
    query = query.in("assigned_to", memberIds);
  }

  // Pipeline-access enforcement (dormant until Phase 3 when restrictive positions exist)
  if (auth.permissions.pipelineAccess !== "all") {
    query = query.in("pipeline_id", [...auth.permissions.pipelineAccess.ids]);
  }

  if (assignedTo) {
    query = query.eq("assigned_to", assignedTo);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (search) {
    // Sanitize search input to prevent PostgREST filter injection
    const sanitized = search.replace(/[,().]/g, "");
    if (sanitized) {
      query = query.or(
        `first_name.ilike.%${sanitized}%,last_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`
      );
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("last_activity_at", { ascending: false })
    .range(from, to);

  if (error) {
    log.error({ err: error }, "Failed to fetch leads");
    return apiServiceUnavailable("Failed to fetch leads");
  }

  const total = count || 0;
  log.info({ total, page, pageSize }, "Leads fetched");

  return apiPaginated(data as Lead[], {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const response = await handlePost(request);
  return withCors(response);
}

async function handlePost(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/leads",
    ip,
  });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  // Validate tenant_id is present and valid
  const { valid, errors } = validate(body, {
    tenant_id: [required("tenant_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  // Validate optional IT-agency fields
  const { valid: validExtra, errors: extraErrors } = validate(body, {
    company_name: [optionalMaxLength(255)],
    designation: [optionalMaxLength(255)],
    prospect_industry: [isIn([...PROSPECT_INDUSTRY_VALUES])],
    salutation: [isIn([...SALUTATION_VALUES])],
    company_email: [optionalMaxLength(255), isEmail()],
  });
  if (!validExtra) return apiValidationError(extraErrors);

  const tenantId = body.tenant_id as string;

  // Rate limit by tenant + IP
  const rateResult = await checkRateLimit(
    `form_submit:${tenantId}:${ip}`,
    FORM_SUBMIT_LIMIT
  );
  if (!rateResult.allowed) {
    if (rateResult.retryAfterSeconds > 0) {
      return apiRateLimited(rateResult.retryAfterSeconds);
    }
    return apiServiceUnavailable("Rate limiter unavailable");
  }

  const supabase = await createServiceClient();

  // Verify tenant exists
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, industry_id, name")
    .eq("id", tenantId)
    .single();

  if (!tenant) return apiNotFound("Tenant");

  // ── Branch resolution (insert path only) ────────────────────────────────
  // Read active-branch cookie from the header switcher.
  // "all" / "overall" / empty = Overall view → treat as no active branch.
  const cookieStore = await cookies();
  const edgexBranchVal = cookieStore.get("edgex_branch")?.value ?? null;

  // Optional session auth for creator's branch affiliation (step 3).
  // Dashboard callers have a session; unauthenticated / widget callers return null.
  const dashAuth = await authenticateRequest();

  // Validate the cookie against the caller's real tenant branches — a stale cookie
  // (leftover from another tenant / a deleted branch) must not silently attribute
  // the new lead to the wrong branch. No session (widget/unauthenticated callers) → no
  // tenant context to validate against, so the cookie is ignored either way.
  const validBranchIds =
    dashAuth && dashAuth.entitlements.maxBranches > 1
      ? await getBranchIds(dashAuth.tenantId)
      : [];
  const cookieBranchId = dashAuth ? resolveEffectiveBranch(edgexBranchVal, validBranchIds) : null;

  // Precedence: 1. explicit body branch_id  2. active branch cookie  3. creator's branch
  //             4. tenant default branch (is_default = true)
  const explicitBranchId = (body.branch_id as string | null | undefined) || null;
  const step123BranchId = explicitBranchId ?? cookieBranchId ?? (dashAuth?.branchId ?? null);

  // Step 4: fall back to the tenant's default branch when none of steps 1–3 resolved.
  let creationBranchId = step123BranchId;
  if (!creationBranchId) {
    const { data: defaultBranch } = await supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    creationBranchId = defaultBranch?.id ?? null;
  }
  // ── End branch resolution ────────────────────────────────────────────────

  // Validate assigned_to: must belong to this tenant if provided
  if (body.assigned_to !== undefined && body.assigned_to !== null && body.assigned_to !== "") {
    const { data: assigneeCheck } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", body.assigned_to as string)
      .single();

    if (!assigneeCheck) {
      return apiValidationError({ assigned_to: ["Assignee is not a member of this tenant"] });
    }
  }

  // Validate owner_id: must belong to this tenant if provided
  if (body.owner_id !== undefined && body.owner_id !== null && body.owner_id !== "") {
    const { data: ownerCheck } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", body.owner_id as string)
      .single();

    if (!ownerCheck) {
      return apiValidationError({ owner_id: ["Owner is not a member of this tenant"] });
    }
  }

  const idempotencyKey = body.idempotency_key as string | undefined;
  const leadId = body.lead_id as string | undefined;
  const sessionId = body.session_id as string | undefined;

  // Idempotency check
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .is("deleted_at", null)
      .single();

    if (existing) {
      log.info({ leadId: existing.id }, "Idempotent duplicate — returning existing lead");
      return apiSuccess(existing, 200);
    }
  }

  // Resolve status
  const resolvedStatus = (body.status as string) || (body.is_final ? "new" : "partial");

  // Fetch form config for routing + schema validation (phone-parsing IIFE fetches steps separately)
  let formConfig: {
    id: string;
    target_pipeline_id?: string | null;
    steps?: FormStep[] | null;
    autoresponder?: FormConfig["autoresponder"];
  } | null = null;
  if (body.form_config_id) {
    const { data: fc } = await supabase
      .from("form_configs")
      .select("id, target_pipeline_id, steps, autoresponder")
      .eq("id", body.form_config_id as string)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    formConfig = fc ?? null;
  }

  const resolved = await resolveLeadPipelineAndStage(supabase, {
    tenantId,
    formConfig,
    explicitPipelineId: (body.pipeline_id as string | undefined) ?? null,
    statusSlug: resolvedStatus,
    strictStatus: false,
    log,
  });

  if (!resolved.ok) {
    if (resolved.reason === "no_pipeline") {
      return apiValidationError({ tenant_id: ["Tenant has no default pipeline configured"] });
    }
    return apiValidationError({ status: [`No matching pipeline stage for status "${resolvedStatus}"`] });
  }

  // Mode A schema validation — enforce on final submissions only
  if (body.is_final === true && formConfig?.steps && formConfig.steps.length > 0) {
    const schemaValues = {
      ...((body.custom_fields as Record<string, unknown>) || {}),
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone,
      city: body.city,
      country: body.country,
    };
    const schemaResult = validateSubmissionAgainstForm(formConfig.steps, schemaValues);
    if (!schemaResult.valid) return apiValidationError(schemaResult.errors);
  }

  // Build payload from body
  const leadPayload: Record<string, unknown> = {
    tenant_id: tenantId,
    pipeline_id: resolved.pipelineId,
    session_id: sessionId || body.session_id || null,
    step: body.step ?? 1,
    is_final: body.is_final ?? false,
    status: resolved.statusSlug,
    stage_id: resolved.stageId,
    first_name: body.first_name || null,
    last_name: body.last_name || null,
    email: body.email || null,
    phone: await (async () => {
      const rawPhone = String(body.phone || "").trim();
      if (!rawPhone) return null;
      // Normalize: replace spaces between country code and number with hyphen
      if (rawPhone.startsWith("+")) return rawPhone.replace(/^(\+\d+)\s+/, "$1-");
      // Look up dial code from form config's country field options
      if (body.form_config_id && body.country) {
        try {
          const { data: fc } = await supabase
            .from("form_configs")
            .select("steps")
            .eq("id", body.form_config_id)
            .eq("tenant_id", tenantId)
            .single();
          if (fc?.steps) {
            for (const step of fc.steps as Array<{ fields: Array<{ type: string; name: string; country_field?: string; options?: Array<{ value: string; dial_code?: string }> }> }>) {
              const phoneField = step.fields.find((f) => f.type === "tel" && f.country_field);
              if (phoneField?.country_field) {
                const countryField = step.fields.find((f) => f.name === phoneField.country_field);
                const opt = countryField?.options?.find((o) => o.value === body.country);
                if (opt?.dial_code) return `${opt.dial_code}-${rawPhone}`;
              }
            }
          }
        } catch { /* fall through to raw phone */ }
      }
      return rawPhone || null;
    })(),
    city: body.city || null,
    country: body.country || null,
    custom_fields: body.custom_fields || {},
    file_urls: body.file_urls || {},
    form_config_id: body.form_config_id || null,
    entity_id: body.entity_id || null,
    intake_source: body.intake_source || null,
    intake_medium: body.intake_medium || null,
    intake_campaign: body.intake_campaign || null,
    ref_code: (body.ref_code as string | null | undefined) || null,
    form_source: (body.form_source as string | null | undefined) || null,
    preferred_contact_method: body.preferred_contact_method || null,
    tags: Array.isArray(body.tags) ? body.tags : (tenant.industry_id === "education_consultancy" ? ["student"] : []),
    assigned_to: body.assigned_to || null,
    company_name: body.company_name || null,
    designation: body.designation || null,
    prospect_industry: body.prospect_industry || null,
    owner_id: body.owner_id || null,
    salutation: body.salutation || null,
    company_email: body.company_email || null,
    // Education-only structured fields
    destinations: Array.isArray(body.destinations) ? body.destinations : [],
    field_of_study: (body.field_of_study as string | null | undefined) || null,
    degree_level: (body.degree_level as string | null | undefined) || null,
    ...(idempotencyKey && { idempotency_key: idempotencyKey }),
  };

  // For tenants with lead-lists: assign new leads to the correct list when list_id not supplied.
  // Only applies to brand-new inserts — the update path strips list_id from its payload.
  // Check-in routing:
  //   counselor assigned → Prospects   (walk-in is handed off immediately)
  //   no counselor, lead-exec checker → Qualified (lead-exec owns it)
  //   no counselor, owner/admin/branch-mgr → Qualified (shared pool, assigned_to = null)
  // All other leads go to the intake list. Falls back to null if no matching list exists.
  if (!body.list_id) {
    const isCheckIn = body.intake_medium === "check_in";
    const isContactOnly = isCheckIn && Array.isArray(body.tags) && (body.tags as string[]).includes("other");
    if (isCheckIn && !isContactOnly) {
      const targetSlug = body.assigned_to ? "prospects" : "qualified";
      const { data: targetList } = await supabase
        .from("lead_lists")
        .select("id, pipeline_id")
        .eq("tenant_id", tenantId)
        .eq("slug", targetSlug)
        .limit(1)
        .maybeSingle();
      leadPayload.list_id = targetList?.id ?? null;
      if (targetList?.pipeline_id) {
        const landing = await getPipelineLandingStage(supabase, targetList.pipeline_id);
        if (landing) {
          leadPayload.pipeline_id = targetList.pipeline_id;
          leadPayload.stage_id = landing.id;
          leadPayload.status = landing.slug;
        }
      }

      if (!body.assigned_to) {
        if (dashAuth?.positionSlug === "lead-executive") {
          leadPayload.assigned_to = dashAuth.userId;
        } else {
          leadPayload.assigned_to = null;
        }
      }
    } else if (!isContactOnly) {
      const { data: intakeList } = await supabase
        .from("lead_lists")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_intake", true)
        .limit(1)
        .maybeSingle();
      leadPayload.list_id = intakeList?.id ?? null;
    }
    // isContactOnly → list_id stays null (no pipeline placement)
  } else {
    const explicitListId = (body.list_id as string) ?? null;
    if (explicitListId) {
      const { data: listCheck } = await supabase
        .from("lead_lists")
        .select("id, is_archive, pipeline_id")
        .eq("tenant_id", tenantId)
        .eq("id", explicitListId)
        .maybeSingle();
      if (!listCheck) {
        return apiValidationError({ list_id: ["List not found in this tenant"] });
      }
      if (listCheck.is_archive && !body.archive_reason) {
        return apiValidationError({ archive_reason: ["Archive reason is required when moving to an archive list"] });
      }
      // Align pipeline/stage/status to the chosen list's landing stage.
      // Without this the lead keeps the default-pipeline stage resolved above, whose slug
      // matches no stage in the list's pipeline → blank Status in lead detail.
      if (listCheck.pipeline_id) {
        const landing = await getPipelineLandingStage(supabase, listCheck.pipeline_id);
        if (landing) {
          leadPayload.pipeline_id = listCheck.pipeline_id;
          leadPayload.stage_id = landing.id;
          leadPayload.status = landing.slug;
        }
      }
    }
    leadPayload.list_id = explicitListId;
    if (body.archive_reason) leadPayload.archive_reason = body.archive_reason as string;
  }

  // Education defense-in-depth: mirror the Add-Lead cascade server-side. On manual dashboard
  // creates by an admin/owner or branch-manager, an explicit assignee must hold a position
  // allowed for the chosen Stage — or be the manager of the lead's branch. Scoped to exactly
  // the creators who get the cascade UI, so counselor/lead-caller self-creation is untouched.
  const creatorGetsCascade =
    dashAuth?.role === "owner" ||
    dashAuth?.role === "admin" ||
    dashAuth?.positionSlug === "branch-manager";
  if (
    tenant.industry_id === "education_consultancy" &&
    body.intake_medium === "dashboard" &&
    creatorGetsCascade &&
    leadPayload.assigned_to &&
    leadPayload.list_id
  ) {
    const [{ data: listRow }, { data: assigneeRow }] = await Promise.all([
      supabase
        .from("lead_lists")
        .select("slug")
        .eq("id", leadPayload.list_id as string)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("tenant_users")
        .select("positions(slug)")
        .eq("user_id", leadPayload.assigned_to as string)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    const allowed = STAGE_TEAM_MAP[listRow?.slug ?? ""] ?? [];
    const posEmbed = Array.isArray(assigneeRow?.positions)
      ? (assigneeRow?.positions[0] ?? null)
      : assigneeRow?.positions;
    const assigneeSlug = (posEmbed as { slug?: string } | null)?.slug ?? null;
    let permitted = !!assigneeSlug && allowed.includes(assigneeSlug);
    if (!permitted && creationBranchId) {
      const { data: branchRow } = await supabase
        .from("branches")
        .select("manager_user_id")
        .eq("id", creationBranchId)
        .maybeSingle();
      permitted = branchRow?.manager_user_id === leadPayload.assigned_to;
    }
    // Only reject a known, mismatched funnel position; unknown positions fall through unblocked.
    if (assigneeSlug && !permitted) {
      return apiValidationError({
        assigned_to: [`Assignee is not permitted for the "${listRow?.slug ?? "selected"}" stage`],
      });
    }
  }

  // Set branch on insert path only; stripped from the update destructure below.
  leadPayload.branch_id = creationBranchId;

  // Normalised fields for identity resolution (used in both update + create paths)
  const normalizedEmail = normalizeEmail(leadPayload.email as string | null | undefined);
  const normalizedPhone = normalizePhone(leadPayload.phone as string | null | undefined);

  // Update path: lead_id + session_id provided
  if (leadId && sessionId) {
    const { data: existingLead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .single();

    if (!existingLead) {
      return apiNotFound("Lead");
    }

    // Fall back to the draft's stored email/phone when the finalize payload omits them.
    // Without this, resolveLeadIdentity gets null and creates a standalone duplicate.
    const effectiveEmail = normalizedEmail ?? normalizeEmail((existingLead as Lead).email);
    const effectivePhone = normalizedPhone ?? normalizePhone((existingLead as Lead).phone);

    // ── Dedup fold on finalisation ──
    // Only runs when this step flips is_final to true (multi-step form completion).
    // Resolves identity BEFORE the update so the partial-unique index is never
    // hit by the draft itself.
    if (leadPayload.is_final === true) {
      const updateIdentity = await resolveLeadIdentity(supabase, {
        tenantId,
        normalizedEmail: effectiveEmail,
        normalizedPhone: effectivePhone,
      });

      // Fold: draft email matches a DIFFERENT canonical lead
      if (
        updateIdentity.match === "email" &&
        updateIdentity.existingLead &&
        updateIdentity.existingLead.id !== leadId
      ) {
        const canonical = updateIdentity.existingLead;
        const draftLead = existingLead as Lead;

        // Record submission against canonical (raw payload = assembled draft fields)
        let submissionId: string | undefined;
        try {
          submissionId = await recordSubmission(supabase, {
            tenantId,
            leadId: canonical.id,
            formConfigId: (draftLead.form_config_id as string | null) ?? null,
            sessionId,
            createdVia: "public_form",
            idempotencyKey: idempotencyKey ?? null,
            firstName: draftLead.first_name,
            lastName: draftLead.last_name,
            email: draftLead.email,
            phone: draftLead.phone,
            city: draftLead.city,
            country: draftLead.country,
            normalizedEmail: effectiveEmail,
            normalizedPhone: effectivePhone,
            customFields: draftLead.custom_fields as Record<string, unknown>,
            fileUrls: draftLead.file_urls as Record<string, unknown>,
            intakeSource: draftLead.intake_source,
            intakeMedium: draftLead.intake_medium,
            intakeCampaign: draftLead.intake_campaign,
            entityId: draftLead.entity_id,
            rawPayload: leadPayload,
            matchedExisting: true,
          });
        } catch { /* non-fatal */ }

        // Fill-empty patch on canonical
        const patch = applyCanonicalUpdate(canonical, {
          first_name: draftLead.first_name,
          last_name: draftLead.last_name,
          email: draftLead.email,
          phone: draftLead.phone,
          city: draftLead.city,
          country: draftLead.country,
          entity_id: draftLead.entity_id,
          custom_fields: draftLead.custom_fields as Record<string, unknown>,
          file_urls: draftLead.file_urls as Record<string, unknown>,
          tags: draftLead.tags,
        });
        if (Object.keys(patch).length > 0) {
          await supabase.from("leads").update(patch).eq("id", canonical.id).eq("tenant_id", tenantId);
        }

        // Soft-delete draft: merged_into=canonical, stays is_final=false (no index collision)
        await supabase
          .from("leads")
          .update({ deleted_at: new Date().toISOString(), merged_into: canonical.id })
          .eq("id", leadId)
          .eq("tenant_id", tenantId);

        const foldFormName = await resolveFormName(supabase, (draftLead.form_config_id as string | null) ?? null);
        void emitSubmissionAudit(supabase, {
          tenantId,
          leadId: canonical.id,
          submissionId: submissionId ?? null,
          isFirst: false,
          matchedExisting: true,
          formName: foldFormName,
          ipAddress: ip,
          userAgent,
          requestId,
        });
        void touchLastActivity(supabase, { leadId: canonical.id, tenantId });

        log.info({ draftId: leadId, canonicalId: canonical.id }, "Draft folded into canonical lead");
        return apiSuccess({ ...canonical, id: canonical.id }, 200);
      }
    }

    // Normal update (no fold)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tenant_id: _tenantId, list_id: _listId, branch_id: _branchId, ...updatePayload } = leadPayload;

    const { data: updated, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) {
      log.error({ err: error }, "Failed to update lead");
      return apiServiceUnavailable("Failed to update lead");
    }

    log.info({ leadId }, "Lead updated");

    // Record submission on finalisation
    if (leadPayload.is_final === true) {
      try {
        const submissionId = await recordSubmission(supabase, {
          tenantId,
          leadId,
          formConfigId: (updated as Lead).form_config_id ?? null,
          sessionId,
          createdVia: "public_form",
          idempotencyKey: idempotencyKey ?? null,
          firstName: (updated as Lead).first_name,
          lastName: (updated as Lead).last_name,
          email: (updated as Lead).email,
          phone: (updated as Lead).phone,
          city: (updated as Lead).city,
          country: (updated as Lead).country,
          normalizedEmail: effectiveEmail,
          normalizedPhone: effectivePhone,
          customFields: (updated as Lead).custom_fields as Record<string, unknown>,
          fileUrls: (updated as Lead).file_urls as Record<string, unknown>,
          intakeSource: (updated as Lead).intake_source,
          intakeMedium: (updated as Lead).intake_medium,
          intakeCampaign: (updated as Lead).intake_campaign,
          entityId: (updated as Lead).entity_id,
          rawPayload: leadPayload,
          matchedExisting: false,
        });
        const updateFormName = await resolveFormName(supabase, (updated as Lead).form_config_id ?? null);
        void emitSubmissionAudit(supabase, {
          tenantId,
          leadId,
          submissionId,
          isFirst: true,
          matchedExisting: false,
          formName: updateFormName,
          ipAddress: ip,
          userAgent,
          requestId,
        });
        void touchLastActivity(supabase, { leadId, tenantId });
      } catch { /* non-fatal */ }
    }

    Promise.all([
      createAuditLog({
        tenantId,
        action: "lead.updated",
        entityType: "lead",
        entityId: leadId,
        ipAddress: ip,
        userAgent,
        requestId,
      }),
      emitEvent({
        tenantId,
        type: "lead.updated",
        entityType: "lead",
        entityId: leadId,
        payload: { step: (updated as Lead).step, is_final: (updated as Lead).is_final },
        requestId,
      }),
    ]);

    if (leadPayload.is_final === true) {
      void processEmailForwardRules({
        tenantId,
        lead: updated as Lead,
        newStageId: resolved.stageId,
      }).catch((err) => log.error({ err }, "Email rule on finalize failed"));

      if (formConfig) {
        void processFormAutoresponder(
          formConfig as FormConfig,
          updated as Lead,
          { isResubmission: false, tenant: { name: tenant.name } }
        ).catch(() => {});
      }
    }

    return apiSuccess(updated, 200);
  }

  // Create path — run dedup when is_final (single-step form submissions)
  let createPhoneMatchIds: string[] = [];
  if (leadPayload.is_final === true) {
    const createIdentity = await resolveLeadIdentity(supabase, {
      tenantId,
      normalizedEmail,
      normalizedPhone,
    });
    createPhoneMatchIds = createIdentity.phoneMatchLeadIds;

    if (createIdentity.match === "email" && createIdentity.existingLead) {
      const canonical = createIdentity.existingLead;
      let submissionId: string | undefined;
      try {
        submissionId = await recordSubmission(supabase, {
          tenantId,
          leadId: canonical.id,
          formConfigId: leadPayload.form_config_id as string | null,
          sessionId: leadPayload.session_id as string | null,
          createdVia: "public_form",
          idempotencyKey: idempotencyKey ?? null,
          firstName: leadPayload.first_name as string | null,
          lastName: leadPayload.last_name as string | null,
          email: leadPayload.email as string | null,
          phone: leadPayload.phone as string | null,
          city: leadPayload.city as string | null,
          country: leadPayload.country as string | null,
          normalizedEmail,
          normalizedPhone,
          customFields: leadPayload.custom_fields as Record<string, unknown>,
          fileUrls: leadPayload.file_urls as Record<string, unknown>,
          intakeSource: leadPayload.intake_source as string | null,
          intakeMedium: leadPayload.intake_medium as string | null,
          intakeCampaign: leadPayload.intake_campaign as string | null,
          entityId: leadPayload.entity_id as string | null,
          rawPayload: leadPayload,
          matchedExisting: true,
        });
      } catch { /* non-fatal */ }

      const patch = applyCanonicalUpdate(canonical, {
        first_name: leadPayload.first_name as string | null,
        last_name: leadPayload.last_name as string | null,
        email: leadPayload.email as string | null,
        phone: leadPayload.phone as string | null,
        city: leadPayload.city as string | null,
        country: leadPayload.country as string | null,
        entity_id: leadPayload.entity_id as string | null,
        custom_fields: leadPayload.custom_fields as Record<string, unknown>,
        file_urls: leadPayload.file_urls as Record<string, unknown>,
        tags: leadPayload.tags as string[],
      });
      if (Object.keys(patch).length > 0) {
        await supabase.from("leads").update(patch).eq("id", canonical.id).eq("tenant_id", tenantId);
      }

      const createFoldFormName = await resolveFormName(supabase, leadPayload.form_config_id as string | null);
      void emitSubmissionAudit(supabase, {
        tenantId,
        leadId: canonical.id,
        submissionId: submissionId ?? null,
        isFirst: false,
        matchedExisting: true,
        formName: createFoldFormName,
        ipAddress: ip,
        userAgent,
        requestId,
      });
      void touchLastActivity(supabase, { leadId: canonical.id, tenantId });
      (async () => {
        try {
          const fn = (canonical.first_name as string | null) || null;
          const ln = (canonical.last_name as string | null) || null;
          const leadName = `${fn || ""} ${ln || ""}`.trim() || "A lead";
          if (canonical.assigned_to) {
            await upsertThreadNotification({
              tenantId,
              userId: canonical.assigned_to,
              type: NotificationTypes.LEAD_CREATED,
              title: "Resubmission from existing lead",
              message: leadName,
              link: `/leads/${canonical.id}`,
            });
          } else {
            const adminIds = await getTenantAdminRecipients(supabase, tenantId);
            await Promise.all(
              adminIds.map((adminId) =>
                upsertThreadNotification({
                  tenantId,
                  userId: adminId,
                  type: NotificationTypes.LEAD_CREATED,
                  title: "Resubmission from existing lead",
                  message: leadName,
                  link: `/leads/${canonical.id}`,
                })
              )
            );
          }
        } catch (err) {
          log.error({ err }, "Failed to send resubmission notification");
        }
      })();

      // Re-fire the form autoresponder on resubmission (e.g. catalogue re-download).
      // fire_mode:"every" → sends again; fire_mode:"first" → skipped via isResubmission.
      if (formConfig) {
        void processFormAutoresponder(
          formConfig as FormConfig,
          { ...canonical, ...patch } as Lead,
          { isResubmission: true, tenant: { name: tenant.name } }
        ).catch(() => {});
      }

      log.info({ canonicalId: canonical.id }, "Incoming lead deduped into existing canonical");
      return apiSuccess(canonical, 200);
    }
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert(leadPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      // Idempotency key race
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from("leads")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("idempotency_key", idempotencyKey)
          .is("deleted_at", null)
          .single();
        if (existing) {
          log.info({ leadId: existing.id }, "Race condition — returning existing lead");
          return apiSuccess(existing, 200);
        }
      }
      // Email unique-index race — fold into winner
      if (normalizedEmail) {
        const { data: raceMatch } = await supabase
          .from("leads")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("normalized_email", normalizedEmail)
          .is("deleted_at", null)
          .eq("is_final", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (raceMatch) {
          let raceSubmissionId: string | undefined;
          try {
            raceSubmissionId = await recordSubmission(supabase, {
              tenantId,
              leadId: (raceMatch as Lead).id,
              createdVia: "public_form",
              idempotencyKey: idempotencyKey ?? null,
              email: leadPayload.email as string | null,
              normalizedEmail,
              normalizedPhone,
              rawPayload: leadPayload,
              matchedExisting: true,
            });
          } catch { /* non-fatal */ }
          const raceFormName = await resolveFormName(supabase, leadPayload.form_config_id as string | null);
          void emitSubmissionAudit(supabase, {
            tenantId,
            leadId: (raceMatch as Lead).id,
            submissionId: raceSubmissionId ?? null,
            isFirst: false,
            matchedExisting: true,
            formName: raceFormName,
            ipAddress: ip,
            userAgent,
            requestId,
          });
          void touchLastActivity(supabase, { leadId: (raceMatch as Lead).id, tenantId });
          log.info({ leadId: (raceMatch as Lead).id }, "Email unique-index race — folded into existing lead");
          return apiSuccess(raceMatch, 200);
        }
      }
    }
    log.error({ err: error }, "Failed to create lead");
    return apiServiceUnavailable("Failed to create lead");
  }

  log.info({ leadId: lead.id }, "Lead created");

  // Register the initial assignee as a collaborator (engaged-user visibility).
  if ((lead as Lead).assigned_to) {
    try {
      await addLeadCollaborator(supabase, tenantId, lead.id, (lead as Lead).assigned_to);
    } catch (err) {
      log.error({ err }, "addLeadCollaborator on create failed");
    }
  }

  // Lead-exec who checked in retains lifecycle visibility even after a counselor owns it.
  // Guard: skip when lead-exec is already the assignee (prevents duplicate; UNIQUE constraint
  // makes it idempotent anyway, but avoids the extra round-trip).
  if (
    body.intake_medium === "check_in" &&
    dashAuth?.userId &&
    dashAuth.userId !== (lead as Lead).assigned_to
  ) {
    try {
      await addLeadCollaborator(supabase, tenantId, lead.id, dashAuth.userId);
    } catch (err) {
      log.error({ err }, "addLeadCollaborator (checker) on check-in create failed");
    }
  }

  // Assign display ID for education leads (best-effort; null list_id → live → assigns).
  // Re-select display_id so the response includes the freshly-assigned ID.
  if (tenant.industry_id === "education_consultancy") {
    try {
      await assignDisplayIds({
        supabase,
        tenantId,
        industryId: tenant.industry_id,
        destinationListId: (lead as Lead).list_id ?? null,
        leadIds: [lead.id],
      });
      const { data: refreshed } = await supabase
        .from("leads")
        .select("display_id")
        .eq("id", lead.id)
        .single();
      if (refreshed?.display_id) {
        (lead as Record<string, unknown>).display_id = refreshed.display_id;
      }
    } catch (err) {
      log.error({ err }, "assignDisplayIds on create failed");
    }
  }

  // Sync origin branch membership so branch-scoped users see the lead (no-op when null)
  void syncOriginMembership(supabase, tenantId, lead.id, creationBranchId, (lead as Lead).assigned_to ?? null).catch(() => {});

  // Phone duplicate suggestions — non-fatal, never blocks ingestion
  if (createPhoneMatchIds.length > 0) {
    try {
      await recordDuplicateSuggestions(supabase, {
        tenantId,
        leadId: lead.id,
        suggestedLeadIds: createPhoneMatchIds,
        reason: "phone",
      });
    } catch { /* non-fatal */ }
  }

  // Record submission for final leads
  let newSubmissionId: string | undefined;
  if (lead.is_final) {
    try {
      newSubmissionId = await recordSubmission(supabase, {
        tenantId,
        leadId: lead.id,
        formConfigId: (lead as Lead).form_config_id ?? null,
        sessionId: (lead as Lead).session_id ?? null,
        createdVia: "public_form",
        idempotencyKey: idempotencyKey ?? null,
        firstName: (lead as Lead).first_name,
        lastName: (lead as Lead).last_name,
        email: (lead as Lead).email,
        phone: (lead as Lead).phone,
        city: (lead as Lead).city,
        country: (lead as Lead).country,
        normalizedEmail,
        normalizedPhone,
        customFields: (lead as Lead).custom_fields as Record<string, unknown>,
        fileUrls: (lead as Lead).file_urls as Record<string, unknown>,
        intakeSource: (lead as Lead).intake_source,
        intakeMedium: (lead as Lead).intake_medium,
        intakeCampaign: (lead as Lead).intake_campaign,
        entityId: (lead as Lead).entity_id,
        rawPayload: leadPayload,
        matchedExisting: false,
      });
    } catch (err) {
      log.error({ err }, "Failed to record submission");
    }
  }

  if (newSubmissionId) {
    void touchLastActivity(supabase, { leadId: lead.id, tenantId });
    void (async () => {
      const newLeadFormName = await resolveFormName(supabase, (lead as Lead).form_config_id ?? null);
      await emitSubmissionAudit(supabase, {
        tenantId,
        leadId: lead.id,
        submissionId: newSubmissionId,
        isFirst: true,
        matchedExisting: false,
        formName: newLeadFormName,
        ipAddress: ip,
        userAgent,
        requestId,
      });
    })().catch(() => { /* non-fatal */ });
  }

  Promise.all([
    // lead.created audit suppressed when lead.submission was recorded (A4: combined display)
    newSubmissionId
      ? Promise.resolve()
      : createAuditLog({
          tenantId,
          action: "lead.created",
          entityType: "lead",
          entityId: lead.id,
          ipAddress: ip,
          userAgent,
          requestId,
        }),
    emitEvent({
      tenantId,
      type: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      payload: { session_id: lead.session_id, is_final: lead.is_final },
      requestId,
    }),
  ]);

  // Notify on final leads only (partial leads are in-progress form submissions)
  if (lead.is_final) {
    (async () => {
      try {
        const leadName = `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "A lead";
        if (lead.assigned_to) {
          await upsertThreadNotification({
            tenantId,
            userId: lead.assigned_to,
            type: NotificationTypes.LEAD_CREATED,
            title: "New lead assigned to you",
            message: leadName,
            link: `/leads/${lead.id}`,
          });
        } else {
          const adminIds = await getTenantAdminRecipients(supabase, tenantId);
          await Promise.all(
            adminIds.map((adminId) =>
              upsertThreadNotification({
                tenantId,
                userId: adminId,
                type: NotificationTypes.LEAD_CREATED,
                title: "New lead",
                message: leadName,
                link: `/leads/${lead.id}`,
              })
            )
          );
        }
      } catch (err) {
        log.error({ err }, "Failed to create lead.created notification");
      }
    })();
  }

  if (lead.is_final) {
    void processEmailForwardRules({
      tenantId,
      lead: lead as Lead,
      newStageId: resolved.stageId,
    }).catch((err) => log.error({ err }, "Email rule on create failed"));

    if (formConfig) {
      void processFormAutoresponder(
        formConfig as FormConfig,
        lead as Lead,
        { isResubmission: false, tenant: { name: tenant.name } }
      ).catch(() => {});
    }

    // Record affiliate conversion when ref_code is present (Admizz affiliate leads)
    const leadRefCode = (lead as Lead).ref_code ?? null;
    if (leadRefCode && tenant.industry_id === "education_consultancy") {
      void supabase
        .rpc("record_affiliate_conversion", {
          p_lead_id: lead.id,
          p_ref_code: leadRefCode,
          p_form_source: (lead as Lead).form_source ?? null,
        })
        .then(({ error: rpcErr }) => {
          if (rpcErr) log.error({ err: rpcErr, leadId: lead.id }, "record_affiliate_conversion failed");
        });
    }
  }

  return apiSuccess(lead, 201);
}
