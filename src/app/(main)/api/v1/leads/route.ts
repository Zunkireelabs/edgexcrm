import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizePhoneForStorage } from "@/lib/phone-utils";
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
import { validate, required, isUUID, optionalMaxLength, isIn, isEmail, isPhoneForCountry } from "@/lib/api/validation";
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
import { branchMemberIds, syncOriginMembership } from "@/lib/leads/branch-membership";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { addLeadCollaborator } from "@/lib/leads/collaborators";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { getSourceFacet } from "@/lib/leads/aggregates";
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
import { coerceAcademicPayload, hasProspectQualification, canBypassProspectQualification } from "@/lib/leads/prospect-qualification";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// List-view column projection — every Lead column the table can render, EXCEPT
// file_urls (a JSONB blob the table never reads — the dominant remaining cost in
// the old `select("*")` payload). custom_fields IS included: the table reads it
// live at render time (leads-table.tsx `cf:` columns) and the column picker's
// "available custom fields" list is derived from whatever page is loaded — SSR
// page 1 already has it, so an API page without it would blank out/vanish custom
// columns on every page past 1. At pageSize<=100 the per-page JSONB cost is
// negligible; the 34MB figure was a 16,898-row artifact of loading everything at
// once, not of this one column. The single-lead detail path (GET
// /api/v1/leads/[id]) keeps `select("*")`; only this list endpoint narrows.
// A SINGLE string-literal token (backslash line continuation, not `+` concatenation
// or array.join()) — supabase-js's select() type inference parses the literal type of
// its argument to build the result row type; `+`/`.join()` both widen to plain
// `string`, which collapses that inference to `GenericStringError` under tsc.
const LEADS_LIST_COLUMNS = "id,tenant_id,pipeline_id,session_id,step,is_final,status,\
first_name,last_name,email,phone,city,country,\
stage_id,assigned_to,entity_id,\
intake_source,intake_medium,intake_campaign,ref_code,form_source,\
preferred_contact_method,tags,lead_type,display_id,account_id,\
form_config_id,deleted_at,converted_at,converted_contact_id,idempotency_key,\
ai_score,ai_priority,ai_score_updated_at,\
normalized_email,merged_into,\
company_name,designation,prospect_industry,owner_id,salutation,company_email,\
branch_id,list_id,destinations,field_of_study,degree_level,\
nationality,intake_account,custom_fields,\
pre_app_fee_status,pre_app_fee_amount,pre_app_fee_notes,\
see_gpa,see_institution,see_passed_year,\
plus_two_gpa,plus_two_institution,plus_two_passed_year,\
bachelor_gpa,bachelor_institution,bachelor_passed_year,\
masters_gpa,masters_institution,masters_passed_year,\
ielts_score,pte_score,toefl_score,sat_score,gre_gmat_score,\
archive_reason,archived_by,archived_at,archived_from_list_id,archived_from_status,\
stage_changed_at,last_activity_at,created_at,updated_at";

// Sort allow-list — never interpolate a client-supplied column name into the query.
// Only "created_at" is covered by an index (idx_leads_tenant_created_active); the
// others page-table already offered client-side and are kept for parity, at the
// cost of an in-memory sort node over the tenant's active row set (bounded by
// tenant size, not full-table — see PR report for measured cost).
const SORT_COLUMNS: Record<string, string[]> = {
  created_at: ["created_at"],
  last_activity_at: ["last_activity_at"],
  updated_at: ["updated_at"],
  first_name: ["first_name", "last_name"],
  email: ["email"],
};

// Only UUID-shaped tokens are ever interpolated into a raw `.or()` filter string
// (the `assignees` filter below) — anything else is dropped rather than trusted.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const funnelKey = searchParams.get("funnel");
  // Count is exact but costly (measured 432ms on prod's 16,898-row Admizz tenant — a
  // seq scan forced by the tags filter). Callers fetch it once per filter-set change
  // (page=1, or any filter/search/sort edit) and reuse the total client-side while
  // paging within that same filter set; count=0 skips the recompute.
  const wantCount = searchParams.get("count") !== "0";

  // Toolbar secondary filters (form/counselor/collaborators/source/tag/created/
  // prospect industry) — applied server-side against the FULL matching set, not just
  // the loaded page. All values below are passed through supabase-js's parameterized
  // filter methods (.eq/.in/.contains/.gte), never string-interpolated into a raw
  // filter, except `assignees` — its UUID-validated ids are interpolated into an
  // `.or()` string below because that's the only way to express "unassigned OR in
  // this list"; validation happens right before that interpolation.
  const formFilter = searchParams.get("form");
  // Pipeline-board column identity (KANBAN-PAGINATION-BRIEF Phase 1 / stage filter) — a
  // pipeline column is a stage_id, unlike the list-Kanban's (list,status) columns. Only
  // a UUID-shaped value is ever applied; anything else is dropped silently (same
  // never-interpolate-untrusted-input posture as `assignees`/`collaborators` above,
  // though this one goes through .eq(), never a raw string).
  const stageFilterRaw = searchParams.get("stage");
  const stageFilter = stageFilterRaw && UUID_RE.test(stageFilterRaw) ? stageFilterRaw : null;
  const tagFilter = searchParams.get("tag");
  const createdFilter = searchParams.get("created"); // today | week | month
  const industryFilter = searchParams.get("industry"); // prospect_industry value, or "__none__"
  const sourceFilter = (searchParams.get("source") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const assigneesTokens = (searchParams.get("assignees") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  // Collaborator filter is user ids only (never leaked into a raw string — see below),
  // so no UUID validation needed for injection-safety; malformed ids just match nothing.
  const collaboratorIds = (searchParams.get("collaborators") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  // Sort — allow-listed against SORT_COLUMNS, never interpolated. id is always the
  // final tiebreaker so a paginated sort never reshuffles rows between pages.
  const sortKey = searchParams.get("sort") || "created_at";
  const sortColumns = SORT_COLUMNS[sortKey];
  if (!sortColumns) {
    return apiValidationError({ sort: [`Unknown sort key "${sortKey}"`] });
  }
  const orderParam = searchParams.get("order");
  if (orderParam !== null && orderParam !== "asc" && orderParam !== "desc") {
    return apiValidationError({ order: ['order must be "asc" or "desc"'] });
  }
  const sortAscending = orderParam === "asc";

  const supabase = await createServiceClient();
  const userClient = await createClient(); // RLS-context client — leads_visible_to_user() needs a real auth.uid()
  const isAdminOrOwner = auth.role === "owner" || auth.role === "admin";

  // Resolve ?list=slug / ?funnel=key for lead-lists feature. Mirrors the page's own
  // resolution (src/app/(main)/(dashboard)/leads/page.tsx) exactly, including the
  // "delete" slug's special recycle-bin meaning and the is_staging admin/owner gate —
  // this endpoint must reach the identical row set the page would render for the
  // same URL, not a parallel/divergent implementation.
  let resolvedListId: string | null = null;
  let funnelListIds: string[] = [];
  let excludeListIds: string[] = [];
  let onlyDeleted = false;
  if (getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) {
    const { data: lists } = await supabase
      .from("lead_lists")
      .select("id, slug, is_archive, is_staging, funnel_key, access")
      .eq("tenant_id", auth.tenantId);

    if (lists) {
      // Master view (no list/funnel) excludes both archive AND staging lists — the
      // page's `excludeIds` (page.tsx) filters on `is_archive || is_staging`; the old
      // version of this route only excluded is_archive, a real parity gap.
      excludeListIds = lists.filter((l) => l.is_archive || l.is_staging).map((l) => l.id);

      if (listSlug) {
        const targetList = lists.find((l) => l.slug === listSlug);
        if (!targetList) {
          log.info({ listSlug }, "List not found");
          return apiForbidden();
        }
        // Staging lists (e.g. New Leads) are admin/owner only — direct URL/param
        // bypass must 403 the same way the page 404s (page.tsx: `notFound()`).
        if (targetList.is_staging && !isAdminOrOwner) return apiForbidden();
        const accessible = canAccessList(
          auth.permissions,
          targetList.access as { mode: string; positionIds?: string[] },
          auth.positionId,
          targetList.id,
        );
        if (!accessible) return apiForbidden();
        // The recycle bin is a real lead_lists row (slug "delete") whose access/staging
        // gates above still apply — but instead of filtering to its list_id, it flips
        // the query to the soft-deleted set and skips every other list filter (a
        // deleted lead's old list_id is irrelevant; the bin spans all lists).
        if (targetList.slug === "delete") {
          onlyDeleted = true;
        } else {
          resolvedListId = targetList.id;
        }
      } else if (funnelKey) {
        // it_agency funnel workspace: all of the funnel's stage-lists at once,
        // access-filtered exactly like the page's activeFunnelLists.
        funnelListIds = lists
          .filter((l) => l.funnel_key === funnelKey)
          .filter((l) =>
            canAccessList(
              auth.permissions,
              l.access as { mode: string; positionIds?: string[] },
              auth.positionId,
              l.id,
            ),
          )
          .map((l) => l.id);
      }
    }
  }

  // Scope enforcement: own (counselor) + team (branch manager, with §4.1 NULL-branch fallback).
  // Computed before the base query so visibleLeadsBase() can use it (uncapped; migration 179).
  const poolSlug = auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
    ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
    : null;
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId, poolSlug);
  const useSharedPool = !!(auth.branchId && isSharedPoolList(auth.permissions, resolvedListId));

  // Own-scope AND branch-scope both route through the uncapped visibility RPC (needs
  // the RLS-context client for auth.uid() — leads_visible_to_user() gates on it for
  // every p_scope, not just 'own'). Shared-pool and unrestricted (owner/admin) stay on
  // the plain service-client query. Branch scope used to keep its own narrower,
  // hand-rolled `.or()` clause built from an unbounded `lead_branches` fetch — that's
  // the 68KB-URL 503 (>1,855 shared ids) and the silent 1,000-row PostgREST truncation
  // this fix removes. leads_visible_to_user()'s branch predicate is a strict superset
  // (also matches unassigned leads whose branch_id matches) and is what dashboard/
  // insights/pipeline counts already use — collapsing onto it is the fix, not a
  // side effect (see docs/BRANCH-SCOPE-TRUNCATION-503-BRIEF.md).
  const countOpts = wantCount ? { count: "exact" as const } : {};
  const useVisibilityRpc = !useSharedPool && ((scope.restrictToSelf && scope.userId) || !!scope.branchId);
  // Collaborator filter needs an inner-join embed to filter on lead_collaborators.user_id
  // rather than resolving matching lead ids client-side first — a popular collaborator can
  // hold 1000+ historical leads (four Admizz interns hold 1,272-1,319), and bridging that
  // through a caller-built `.in("id", [...])` array is exactly the undici 16KB-URL pattern
  // that caused the 300-id visibility bug (non-negotiable #1). PostgREST compiles a filter
  // on an embedded to-many resource to an EXISTS-style semi-join, so it does not duplicate
  // parent rows the way a literal SQL INNER JOIN would — confirmed against this repo's other
  // paginated+counted `!inner` filters (e.g. badge-counts route.ts). RETURNS SETOF leads on
  // leads_visible_to_user() (migration 179) means the embed works over the RPC path too.
  // Widened to `string` (not the LEADS_LIST_COLUMNS literal type) — the join-embed
  // branch isn't a shape select()'s compile-time parser recognizes, which otherwise
  // collapses inference to `ParserError` (see the LEADS_LIST_COLUMNS comment above).
  // The `data as Lead[]` / `Record<string, unknown>` casts below already carry the
  // real typing, same as every other dynamically-shaped query in this route.
  const selectColumns: string = collaboratorIds.length > 0
    ? `${LEADS_LIST_COLUMNS},lead_collaborators!inner(user_id)`
    : LEADS_LIST_COLUMNS;
  let query = useVisibilityRpc
    ? visibleLeadsBase({ user: userClient, service: supabase }, auth.tenantId, scope, countOpts).select(selectColumns)
    : supabase.from("leads").select(selectColumns, countOpts).eq("tenant_id", auth.tenantId);

  query = onlyDeleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

  if (!includeConverted) {
    query = query.is("converted_at", null);
  }

  // Exclude "other" tagged contacts — they live on the /contacts page, not in lead lists
  query = query.not("tags", "cs", '{"other"}');

  // Apply list/funnel filters — skipped entirely for the recycle bin (onlyDeleted spans
  // every list; a deleted lead's old list_id is not a filter axis there), mirroring
  // getLeads's applyFilters (src/lib/supabase/queries.ts).
  if (!onlyDeleted) {
    if (resolvedListId) {
      query = query.eq("list_id", resolvedListId);
    } else if (funnelListIds.length > 0) {
      query = query.in("list_id", funnelListIds);
    } else if (excludeListIds.length > 0) {
      // Master view: exclude leads in archive/staging lists
      query = query.or(`list_id.is.null,list_id.not.in.(${excludeListIds.join(",")})`);
    }
  }

  // Hoisted (not just applied to `query` below) so the facets=source branch further
  // down can pass the SAME resolved id set into lead_aggregates() instead of
  // re-deriving this scope logic a second time — see migration 194's ADDENDUM header.
  let sharedPoolAssignedToAny: string[] | null = null;

  if (useSharedPool) {
    // auth.branchMemberIds is empty for own-scope, so resolve explicitly.
    const memberIds = await branchMemberIds(supabase, auth.tenantId, auth.branchId!);
    query = query.in("assigned_to", memberIds);
    assignedTo = null;
    sharedPoolAssignedToAny = memberIds;
  } else if (scope.restrictToSelf) {
    assignedTo = null; // self-scoped users: ignore any client assignedTo param — visibility already applied above
  }
  // scope.branchId (non-shared-pool): no further filter needed here — the base query
  // above already routed through visibleLeadsBase()'s branch-scope RPC, which is the
  // uncapped, unbounded-URL-free replacement for the deleted lead_branches fetch + .or().

  // Admin branch focus filter (?branch_id= switcher) — honored ONLY for all-scope callers;
  // team/own users cannot widen or redirect their scope via this param. Same shape as
  // the shared-pool AND-filter above (both are "further restrict an already-resolved
  // 'all' scope by an assigned_to allowlist") — the facets branch below reuses whichever
  // of the two is active.
  const adminBranchFilter = searchParams.get("branch_id");
  if (adminBranchFilter && auth.permissions.leadScope === "all") {
    const memberIds = await branchMemberIds(supabase, auth.tenantId, adminBranchFilter);
    query = query.in("assigned_to", memberIds);
    sharedPoolAssignedToAny = memberIds;
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

  if (stageFilter) {
    query = query.eq("stage_id", stageFilter);
  }

  if (search) {
    // Sanitize search input to prevent PostgREST filter injection
    const sanitized = search.replace(/[,().]/g, "");
    if (sanitized) {
      const orClauses = [
        `first_name.ilike.%${sanitized}%`,
        `last_name.ilike.%${sanitized}%`,
        `email.ilike.%${sanitized}%`,
        `phone.ilike.%${sanitized}%`,
      ];

      // Full-name search: "John Smith" won't match first_name/last_name
      // individually since PostgREST can't filter on a concatenated
      // expression — match token pairs against first/last in either order.
      const tokens = sanitized.trim().split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        const [t1, t2] = tokens;
        orClauses.push(
          `and(first_name.ilike.%${t1}%,last_name.ilike.%${t2}%)`,
          `and(first_name.ilike.%${t2}%,last_name.ilike.%${t1}%)`
        );
      }

      query = query.or(orClauses.join(","));
    }
  }

  // ── Toolbar secondary filters (form/counselor/collaborators/source/tag/created/
  // prospect industry) — composed with every filter above via AND, same as status/
  // search. These used to be applied client-side over whichever page happened to be
  // loaded, which silently narrowed a "300 matching leads" filter down to "2, because
  // that's all that fit on this page" (LEADS-SERVER-PAGINATION-BRIEF review). ──
  if (formFilter && formFilter !== "all") {
    query = query.eq("form_config_id", formFilter);
  }

  if (assigneesTokens.length > 0) {
    const wantsUnassigned = assigneesTokens.includes("unassigned");
    const ids = assigneesTokens.filter((t) => t !== "unassigned" && UUID_RE.test(t));
    if (wantsUnassigned && ids.length > 0) {
      query = query.or(`assigned_to.is.null,assigned_to.in.(${ids.join(",")})`);
    } else if (wantsUnassigned) {
      query = query.is("assigned_to", null);
    } else if (ids.length > 0) {
      query = query.in("assigned_to", ids);
    }
  }

  if (collaboratorIds.length > 0) {
    query = query.in("lead_collaborators.user_id", collaboratorIds);
  }

  if (sourceFilter.length > 0) {
    query = query.in("intake_source", sourceFilter);
  }

  if (tagFilter && tagFilter !== "all") {
    query = query.contains("tags", [tagFilter]);
  }

  if (industryFilter && industryFilter !== "all") {
    query = industryFilter === "__none__"
      ? query.is("prospect_industry", null)
      : query.eq("prospect_industry", industryFilter);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const CREATED_WINDOW_MS: Record<string, number> = { today: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS };
  const createdAfter = createdFilter && createdFilter !== "all" && CREATED_WINDOW_MS[createdFilter]
    ? new Date(Date.now() - CREATED_WINDOW_MS[createdFilter])
    : null;

  if (createdAfter) {
    query = query.gte("created_at", createdAfter.toISOString());
  }

  // Opt-in Source facet (?facets=source) — same "opt-in, separate round-trip" shape
  // as ?counts=1 (lead-lists route). Computed via lead_aggregates() (migration 194's
  // ADDENDUM) over every filter above EXCEPT source itself, per the brief: the option
  // list AND its counts used to come from `localLeads` — the current 25-row server
  // page — which is what made this facet broken rather than merely incomplete once
  // #332 shipped 25-row pages. Recycle-bin (onlyDeleted) leads are excluded from
  // lead_aggregates unconditionally, so this facet is not offered there — a known,
  // narrow gap (the recycle bin has no source dropdown today).
  //
  // KNOWN GAP (pipeline-column-pagination Phase 1): lead_aggregates() (migration 194)
  // has no `p_stage_eq` param, so a `?stage=` filter is NOT mirrored into this facet the
  // way `status`/`list`/etc. are below. A caller combining `stage` with `facets=source`
  // gets a facet computed WITHOUT the stage restriction — flagged, not silently fixed;
  // closing it needs a migration (out of this PR's additive-only-locally scope).
  if (searchParams.get("facets") === "source" && !onlyDeleted) {
    // Match route.ts:370's `.in("pipeline_id", [])` semantics exactly: an empty allowlist
    // means the page returns zero leads, so the facet must be empty too. aggregates.ts
    // omits an empty p_pipeline_ids (→ NULL → no restriction), which would otherwise
    // count the whole tenant for a user whose list is empty.
    if (auth.permissions.pipelineAccess !== "all" && auth.permissions.pipelineAccess.ids.size === 0) {
      return apiSuccess({ facet: "source", options: [] });
    }

    const assigneesIds = assigneesTokens.filter((t) => t !== "unassigned" && UUID_RE.test(t));
    const wantsUnassigned = assigneesTokens.includes("unassigned");
    const validCollaboratorIds = collaboratorIds.filter((id) => UUID_RE.test(id));

    if (scope.restrictToSelf && !scope.userId) {
      throw new Error("leads/facets: scope.restrictToSelf requires scope.userId");
    }

    // Facet must follow the page: branch scope now resolves through the same
    // leads_visible_to_user() 'branch' predicate the base query uses above, not the
    // deleted 'ids_any' hand-rolled id-array path. Page and facet resolving to the
    // identical predicate is the whole point of this fix.
    const facetScope: "own" | "all" | "branch" =
      !useSharedPool && scope.restrictToSelf && scope.userId
        ? "own"
        : scope.branchId && !useSharedPool
          ? "branch"
          : "all";

    let options: Awaited<ReturnType<typeof getSourceFacet>>;
    try {
      options = await getSourceFacet({
        tenantId: auth.tenantId,
        scope: facetScope,
        user: facetScope === "own" ? scope.userId : null,
        userBranchId: scope.userBranchId,
        crossPoolSlug: scope.crossBranchPoolListSlug,
        branchId: facetScope === "branch" ? scope.branchId : null,
        sharedPoolAssignedToAny,
        pipelineIds: auth.permissions.pipelineAccess !== "all" ? [...auth.permissions.pipelineAccess.ids] : null,
        status: status || null,
        assigneesAny: assigneesIds.length > 0 ? assigneesIds : null,
        includeUnassigned: wantsUnassigned,
        collaboratorIds: validCollaboratorIds.length > 0 ? validCollaboratorIds : null,
        tag: tagFilter && tagFilter !== "all" ? tagFilter : null,
        prospectIndustry: industryFilter && industryFilter !== "all" && industryFilter !== "__none__" ? industryFilter : null,
        prospectIndustryNone: industryFilter === "__none__",
        formConfigId: formFilter && formFilter !== "all" && UUID_RE.test(formFilter) ? formFilter : null,
        createdAfter,
        // Mirror the page query's either/or (route.ts:309-316) exactly: an explicit list
        // wins outright, a funnel's list set wins next, and the archive/staging exclusion
        // only applies when neither is present. Passing more than one of these unconditionally
        // ANDs them in lead_aggregates — for a staging list that becomes `list_id = X AND
        // list_id NOT IN (…X…)`, an unsatisfiable predicate that zeroed the facet.
        listIdEq: resolvedListId,
        listIdAny: !resolvedListId && funnelListIds.length > 0 ? funnelListIds : null,
        excludeListIds:
          !resolvedListId && funnelListIds.length === 0 && excludeListIds.length > 0
            ? excludeListIds
            : null,
        search: search ? search.replace(/[,().]/g, "") : null,
        includeConverted,
      });
    } catch (err) {
      log.error({ err }, "Failed to fetch source facet");
      return apiServiceUnavailable("Failed to fetch source facet");
    }

    log.info({ tenantId: auth.tenantId, options: options.length }, "Source facet fetched");
    return apiSuccess({ facet: "source", options });
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // created_at DESC, id DESC is index-ordered (idx_leads_tenant_created_active) — no
  // sort node, no page drift. Non-default sort keys still get id DESC as the final
  // tiebreaker so ties never reshuffle rows between pages.
  for (const col of sortColumns) {
    query = query.order(col, { ascending: sortAscending });
  }
  query = query.order("id", { ascending: false });

  const { data, error, count } = await query.range(from, to);

  if (error) {
    log.error({ err: error }, "Failed to fetch leads");
    return apiServiceUnavailable("Failed to fetch leads");
  }

  // -1 sentinel: count was skipped (?count=0, §3 — exact count is ~432ms on Admizz's
  // 16,898 rows). The caller must have a cached total from a prior count=1 response
  // for the same filter set before it ever sends count=0; apiPaginated cannot enforce
  // that contract, only signal "not computed" instead of silently lying with 0.
  const total = wantCount ? (count ?? 0) : -1;
  log.info({ total, page, pageSize, wantCount }, "Leads fetched");

  // Strip the lead_collaborators embed — it only existed to filter (see selectColumns
  // above), it is not part of the Lead shape the client expects. `data`'s inferred type
  // is the widened-string fallback (see selectColumns above), hence the `unknown` hop.
  const responseData = collaboratorIds.length > 0
    ? (data as unknown as Array<Record<string, unknown>>).map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lead_collaborators, ...rest } = row;
        return rest;
      })
    : data;

  return apiPaginated(responseData as unknown as Lead[], {
    page,
    pageSize,
    total,
    totalPages: total === -1 ? -1 : Math.ceil(total / pageSize),
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
    phone: normalizePhoneForStorage(await (async () => {
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
    })()),
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
    ...coerceAcademicPayload(body),
    ...(idempotencyKey && { idempotency_key: idempotencyKey }),
  };

  // Country-aware phone format check — education_consultancy only, format-only
  // (doesn't make phone required). Runs after the phone-resolution IIFE above so
  // it validates the final "+<dial>-<local>" shape, not raw client input. Scoped
  // to is_final like the schema validation above it — the public form's
  // per-step savePartial() draft saves (is_final omitted) must never hard-fail
  // here, since failures there are swallowed client-side as non-blocking.
  if (tenant.industry_id === "education_consultancy" && body.is_final === true) {
    const { valid: validPhone, errors: phoneErrors } = validate(leadPayload, {
      phone: [isPhoneForCountry()],
    });
    if (!validPhone) return apiValidationError(phoneErrors);
  }

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

  // Prospect-qualification gate (server backstop). Covers BOTH create paths — the check-in
  // auto-route above and an explicit list_id from AddLeadSheet — since either can resolve
  // leadPayload.list_id to the Prospects list.
  if (tenant.industry_id === "education_consultancy" && leadPayload.list_id) {
    const { data: finalList } = await supabase
      .from("lead_lists")
      .select("slug")
      .eq("id", leadPayload.list_id as string)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (
      finalList?.slug === "prospects" &&
      !hasProspectQualification(leadPayload) &&
      !(dashAuth && canBypassProspectQualification(dashAuth.permissions.baseTier, dashAuth.positionSlug))
    ) {
      return apiValidationError({
        academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."],
      });
    }
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
        .select("role, positions(slug)")
        .eq("user_id", leadPayload.assigned_to as string)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    const allowed = STAGE_TEAM_MAP[listRow?.slug ?? ""] ?? [];
    const posEmbed = Array.isArray(assigneeRow?.positions)
      ? (assigneeRow?.positions[0] ?? null)
      : assigneeRow?.positions;
    const assigneeSlug = (posEmbed as { slug?: string } | null)?.slug ?? null;
    // Admins are always a valid assignee at any stage.
    let permitted = assigneeRow?.role === "admin" || (!!assigneeSlug && allowed.includes(assigneeSlug));
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
