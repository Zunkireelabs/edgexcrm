import { createClient } from "@/lib/supabase/server";

export interface WeekBucketCounts {
  all: number;
  thisWeek: number;
  lastWeek: number;
}

export interface SourceCombo {
  formConfigId: string | null;
  intakeSource: string | null;
  count: number;
}

export interface LeadAggregates {
  /** Raw `status` column. Feeds LeadsByStageChart + the legacy (no-stages) StatsCards path. */
  status: Record<string, WeekBucketCounts>;
  /** stage_id-keyed, only rows where stage_id IS NOT NULL. Feeds the stage-driven StatsCards path. */
  stage: Record<string, WeekBucketCounts>;
  /** status-keyed, only rows where stage_id IS NULL — matchesStage()'s fallback branch. */
  stageFallbackStatus: Record<string, WeekBucketCounts>;
  /** (form_config_id, intake_source) pairs — feeds LeadsBySourceChart's name resolution. */
  sourceCombos: SourceCombo[];
  /** assigned_to-keyed ("(unassigned)" sentinel). Feeds LeadsByCounselorChart. */
  counselor: Record<string, number>;
  /** list_id-keyed ("(none)" sentinel). Feeds ListFunnelBoard column counts. */
  list: Record<string, number>;
  /** list_id -> sorted distinct statuses present in that list. Feeds ListFunnelBoard's filter chips. */
  listStatuses: Record<string, string[]>;
  /** Sum of status.*.all — never issue a second query for this. */
  total: number;
}

/** Superset of the scope shapes callers pass (dashboard's LeadQueryScope, pipeline's
 * ad-hoc excludeOtherType extension). Mirrors visibleLeadsBase()'s own/branch/all
 * dispatch — see src/lib/leads/visibility-query.ts. */
export interface AggregateScope {
  restrictToSelf?: boolean;
  userId?: string;
  branchId?: string | null;
  userBranchId?: string | null;
  crossBranchPoolListSlug?: string | null;
  pipelineIds?: string[] | null;
  excludeOtherType?: boolean;
}

const SEP = "\x1f";

function emptyBucket(): WeekBucketCounts {
  return { all: 0, thisWeek: 0, lastWeek: 0 };
}

function bump(map: Record<string, WeekBucketCounts>, key: string, bucket: string, cnt: number) {
  const entry = map[key] ?? (map[key] = emptyBucket());
  if (bucket === "all") entry.all += cnt;
  else if (bucket === "this_week") entry.thisWeek += cnt;
  else if (bucket === "last_week") entry.lastWeek += cnt;
}

interface AggregateRow {
  dimension: string;
  key: string;
  bucket: string;
  cnt: number;
}

/** Reshape the flat rows from the `lead_aggregates` RPC (migration 194) into LeadAggregates. */
export function reshapeLeadAggregateRows(rows: AggregateRow[]): LeadAggregates {
  const status: Record<string, WeekBucketCounts> = {};
  const stage: Record<string, WeekBucketCounts> = {};
  const stageFallbackStatus: Record<string, WeekBucketCounts> = {};
  const sourceCombos: SourceCombo[] = [];
  const counselor: Record<string, number> = {};
  const list: Record<string, number> = {};
  const listStatusSet: Record<string, Set<string>> = {};

  for (const row of rows) {
    const cnt = Number(row.cnt);
    switch (row.dimension) {
      case "status":
        bump(status, row.key, row.bucket, cnt);
        break;
      case "stage":
        bump(stage, row.key, row.bucket, cnt);
        break;
      case "stage_fallback_status":
        bump(stageFallbackStatus, row.key, row.bucket, cnt);
        break;
      case "source_combo": {
        const sepIdx = row.key.indexOf(SEP);
        const formConfigId = sepIdx >= 0 ? row.key.slice(0, sepIdx) : "";
        const intakeSource = sepIdx >= 0 ? row.key.slice(sepIdx + 1) : "";
        sourceCombos.push({
          formConfigId: formConfigId || null,
          intakeSource: intakeSource || null,
          count: cnt,
        });
        break;
      }
      case "counselor":
        counselor[row.key] = (counselor[row.key] ?? 0) + cnt;
        break;
      case "list":
        list[row.key] = (list[row.key] ?? 0) + cnt;
        break;
      case "list_status": {
        const sepIdx = row.key.indexOf(SEP);
        const listId = sepIdx >= 0 ? row.key.slice(0, sepIdx) : row.key;
        const listStatus = sepIdx >= 0 ? row.key.slice(sepIdx + 1) : "";
        if (!listStatusSet[listId]) listStatusSet[listId] = new Set();
        if (cnt > 0 && listStatus) listStatusSet[listId].add(listStatus);
        break;
      }
      default:
        break;
    }
  }

  const listStatuses: Record<string, string[]> = {};
  for (const [listId, set] of Object.entries(listStatusSet)) {
    listStatuses[listId] = [...set].sort();
  }

  const total = Object.values(status).reduce((sum, b) => sum + b.all, 0);

  return { status, stage, stageFallbackStatus, sourceCombos, counselor, list, listStatuses, total };
}

/** Zero-valued LeadAggregates shape — every consumer's normal empty state. */
export function emptyAggregates(): LeadAggregates {
  return reshapeLeadAggregateRows([]);
}

/**
 * One `lead_aggregates()` RPC round-trip, reshaped for the dashboard / insights /
 * pipeline widgets. Replaces the capped `getLeads()` fetch those pages used to make
 * (silently truncated at 1,000 rows — see docs/DASHBOARD-AGGREGATES-BRIEF.md).
 *
 * `now` drives the week1/week2 boundaries — computed here in TS (not `now()` in SQL)
 * so the boundary matches stats-cards.tsx's own oneWeekAgo/twoWeeksAgo exactly and
 * stays in one place (see migration 194 §2.1 reasoning in the brief).
 */
export async function getLeadAggregates(
  tenantId: string,
  scope: AggregateScope | undefined,
  now: Date,
): Promise<LeadAggregates> {
  const supabase = await createClient();

  const week1Start = new Date(now);
  week1Start.setDate(week1Start.getDate() - 7);
  const week2Start = new Date(now);
  week2Start.setDate(week2Start.getDate() - 14);

  // Never pass an explicit null in the RPC args object — PostgREST serializes a JS
  // null as the literal string "null", which fails to cast to uuid (22P02). Omit the
  // key and let the SQL DEFAULT apply instead (same hazard as visibility-query.ts:18-23).
  const params: Record<string, unknown> = {
    p_tenant: tenantId,
    p_week1_start: week1Start.toISOString(),
    p_week2_start: week2Start.toISOString(),
  };
  if (scope?.restrictToSelf) {
    if (!scope.userId) {
      throw new Error("getLeadAggregates: scope.restrictToSelf requires scope.userId");
    }
    params.p_user = scope.userId;
    params.p_scope = "own";
    if (scope.userBranchId) params.p_user_branch_id = scope.userBranchId;
    if (scope.crossBranchPoolListSlug) params.p_cross_pool_slug = scope.crossBranchPoolListSlug;
  } else if (scope?.branchId) {
    params.p_scope = "branch";
    params.p_branch_id = scope.branchId;
  } else {
    params.p_scope = "all";
  }

  // leadQueryScope returns [] (not null) for a restricted-but-empty pipeline allowlist.
  // getLeads treats that as `.in("pipeline_id", [])` → zero rows, so these pages showed
  // zeros before this PR. Omitting p_pipeline_ids would instead mean "no restriction" and
  // count the whole tenant — fail-open, and a behaviour change. Match getLeads: nothing.
  if (scope?.pipelineIds !== null && scope?.pipelineIds !== undefined && scope.pipelineIds.length === 0) {
    return emptyAggregates();
  }

  if (scope?.pipelineIds && scope.pipelineIds.length > 0) params.p_pipeline_ids = scope.pipelineIds;
  if (scope?.excludeOtherType) params.p_exclude_other_type = true;

  const { data, error } = await supabase.rpc("lead_aggregates", params);
  if (error) {
    // Never render zeros on failure: a silently-wrong number is the defect this module
    // exists to remove, and the likeliest cause is code live before migration 194
    // applied. Throw so Sentry captures it and the page fails visibly instead.
    throw new Error(`lead_aggregates RPC failed for tenant ${tenantId}: ${error.message}`);
  }

  return reshapeLeadAggregateRows((data ?? []) as AggregateRow[]);
}

/**
 * LeadsBySourceChart's resolution: `formMap[form_config_id] || intake_source || "Direct"`,
 * applied once per pre-aggregated combo instead of once per lead. Pulled out as a pure
 * function so it can run against SQL-shaped fixtures in a test without a live DB.
 */
export function resolveSourceCounts(
  combos: SourceCombo[],
  formMap: Record<string, string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { formConfigId, intakeSource, count } of combos) {
    const sourceId = formConfigId || "unknown";
    const sourceName = formMap[sourceId] || intakeSource || "Direct";
    counts[sourceName] = (counts[sourceName] ?? 0) + count;
  }
  return counts;
}

export interface SourceFacetOption {
  name: string;
  count: number;
}

/**
 * Every filter axis /api/v1/leads applies (its GET handler), mirrored so the source
 * facet is computed over the identical predicate — minus `source` itself, per the
 * brief's "pass every active filter except the one being faceted" rule. `scope`
 * dispatches into lead_aggregates()'s own/branch/all modes, which for 'own'/'branch'
 * delegate straight through to leads_visible_to_user() — the same predicate the base
 * page query uses via visibleLeadsBase() (see visibility-query.ts). 'ids_any' plus
 * idsAnyAssignedTo/idsAnyLeadId (still supported by migration 194's SQL) are dead from
 * this route as of the branch-scope fix — no caller passes them anymore; left in the
 * RPC only because nothing else references or removes that SQL path.
 */
export interface SourceFacetParams {
  tenantId: string;
  scope: "own" | "all" | "branch" | "ids_any";
  user?: string | null;
  userBranchId?: string | null;
  crossPoolSlug?: string | null;
  /** p_branch_id for scope 'branch' — mirrors visibleLeadsBase()'s scope.branchId. */
  branchId?: string | null;
  idsAnyAssignedTo?: string[] | null;
  idsAnyLeadId?: string[] | null;
  sharedPoolAssignedToAny?: string[] | null;
  pipelineIds?: string[] | null;
  status?: string | null;
  assigneesAny?: string[] | null;
  includeUnassigned?: boolean;
  collaboratorIds?: string[] | null;
  tag?: string | null;
  prospectIndustry?: string | null;
  prospectIndustryNone?: boolean;
  formConfigId?: string | null;
  createdAfter?: Date | null;
  listIdEq?: string | null;
  listIdAny?: string[] | null;
  excludeListIds?: string[] | null;
  search?: string | null;
  includeConverted?: boolean;
  /** 'intake_source' (exact — the /leads view) or 'intake_source_part' (split on
   * " | " — the staging view). Defaults to 'intake_source'; only /leads uses this
   * facet today. */
  dimension?: "intake_source" | "intake_source_part";
}

export async function getSourceFacet(params: SourceFacetParams): Promise<SourceFacetOption[]> {
  const supabase = await createClient();

  // Week boundaries are required params on lead_aggregates but irrelevant to the
  // source facet (no bucket other than 'all' is requested here) — any valid
  // timestamp satisfies the signature without affecting the result.
  const now = new Date().toISOString();

  const rpcParams: Record<string, unknown> = {
    p_tenant: params.tenantId,
    p_week1_start: now,
    p_week2_start: now,
    p_scope: params.scope,
    p_exclude_other_type: true, // /api/v1/leads always excludes "other"-tagged contacts
  };
  if (params.user) rpcParams.p_user = params.user;
  if (params.branchId) rpcParams.p_branch_id = params.branchId;
  if (params.userBranchId) rpcParams.p_user_branch_id = params.userBranchId;
  if (params.crossPoolSlug) rpcParams.p_cross_pool_slug = params.crossPoolSlug;
  if (params.idsAnyAssignedTo && params.idsAnyAssignedTo.length > 0) rpcParams.p_ids_any_assigned_to = params.idsAnyAssignedTo;
  if (params.idsAnyLeadId && params.idsAnyLeadId.length > 0) rpcParams.p_ids_any_lead_id = params.idsAnyLeadId;
  if (params.sharedPoolAssignedToAny && params.sharedPoolAssignedToAny.length > 0) {
    rpcParams.p_shared_pool_assigned_to_any = params.sharedPoolAssignedToAny;
  }
  if (params.pipelineIds && params.pipelineIds.length > 0) rpcParams.p_pipeline_ids = params.pipelineIds;
  if (params.status) rpcParams.p_status_eq = params.status;
  if (params.assigneesAny && params.assigneesAny.length > 0) rpcParams.p_assignees_any = params.assigneesAny;
  if (params.includeUnassigned) rpcParams.p_include_unassigned = true;
  if (params.collaboratorIds && params.collaboratorIds.length > 0) rpcParams.p_collaborator_ids = params.collaboratorIds;
  if (params.tag) rpcParams.p_tag = params.tag;
  if (params.prospectIndustryNone) rpcParams.p_prospect_industry_none = true;
  else if (params.prospectIndustry) rpcParams.p_prospect_industry = params.prospectIndustry;
  if (params.formConfigId) rpcParams.p_form_config_id = params.formConfigId;
  if (params.createdAfter) rpcParams.p_created_after = params.createdAfter.toISOString();
  if (params.listIdEq) rpcParams.p_list_id_eq = params.listIdEq;
  if (params.listIdAny && params.listIdAny.length > 0) rpcParams.p_list_id_any = params.listIdAny;
  if (params.excludeListIds && params.excludeListIds.length > 0) rpcParams.p_exclude_list_ids = params.excludeListIds;
  if (params.search) rpcParams.p_search = params.search;
  if (params.includeConverted) rpcParams.p_include_converted = true;

  const { data, error } = await supabase.rpc("lead_aggregates", rpcParams);
  if (error) {
    // Same reasoning as getLeadAggregates: an empty dropdown reads as "no sources
    // exist" rather than "the RPC failed" — throw so it fails visibly instead.
    throw new Error(`lead_aggregates source facet failed for tenant ${params.tenantId}: ${error.message}`);
  }

  const dimension = params.dimension ?? "intake_source";
  return (data as AggregateRow[])
    .filter((row) => row.dimension === dimension)
    .map((row) => ({ name: row.key, count: Number(row.cnt) }))
    .sort((a, b) => b.count - a.count);
}
