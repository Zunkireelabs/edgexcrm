import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadVisibilityScope {
  restrictToSelf?: boolean;
  userId?: string;
  branchId?: string | null;
  userBranchId?: string | null;
  crossBranchPoolListSlug?: string | null;
}

/**
 * Base query over `leads`, visibility-scoped to the caller. Chain the caller's own
 * filters (list_id, pipeline_id, deleted_at, converted_at, order, range) on top.
 *  - own / branch scope  -> leads_visible_to_user() SQL fn (uncapped; migration 179)
 *  - unrestricted (owner/admin) -> plain leads select, UNCHANGED.
 * Call this fresh inside each buildQuery() invocation (do not reuse a builder across pages).
 *
 * Never pass an explicit `null` in the rpc args object (only omit the key). PostgREST's
 * GET/HEAD calling convention (used for {head:true}/count-only reads) serializes a JS
 * `null` as the literal string "null" in the query string, which fails to cast to `uuid`
 * (22P02) — confirmed against the local Step-0 POC. Omitting the key lets the SQL
 * function's own DEFAULT NULL apply, which works identically for both the POST (data)
 * and GET/HEAD (count-only) call shapes.
 */
export interface VisibleLeadsClients {
  /** RLS-context client (must carry a real `auth.uid()`) — required by the RPC
   * branches below, which are SECURITY DEFINER and fail closed (zero rows) if
   * called without an authenticated JWT (e.g. a service-role client). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: SupabaseClient<any>;
  /** Service/scoped client for the unrestricted (owner/admin) branch — a direct
   * table read that, post role-scoping revoke, the user-context client can no
   * longer perform. Must carry its own explicit tenant_id filter. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: SupabaseClient<any>;
}

export interface VisibleLeadsExtra {
  /**
   * Narrow the visible set to leads that have at least one of these collaborators, IN SQL
   * (leads_visible_to_user_with_collaborators(), migration 255). Only used on the own / branch
   * RPC paths. The owner/admin path ignores it — there the caller filters with a normal
   * embedded-resource filter, which works over a plain table.
   * Why not an embed filter on the RPC: PostgREST resolves it against `pgrst_call` (42703).
   */
  collaboratorIds?: readonly string[] | null;
  /**
   * Collaborators "is none of" (migration 282). When present, the WHOLE request runs over a SQL function that
   * applies the include / exclude lists — for EVERY role, owner/admin included (an exclusion has no embedded-filter
   * form). Own/branch -> leads_visible_to_user_with_collaborator_filter() (calls leads_visible_to_user(), same
   * visibility); owner/admin -> leads_for_tenant_with_collaborator_filter() (service role, one tenant).
   * Takes precedence over `collaboratorIds`; when absent, behaviour is exactly as before.
   */
  collaboratorExclusion?: { excludeIds: readonly string[]; includeIds?: readonly string[] | null } | null;
}

export function visibleLeadsBase(
  clients: VisibleLeadsClients,
  tenantId: string,
  scope: LeadVisibilityScope | undefined,
  rpcOpts?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
  extra?: VisibleLeadsExtra,
) {
  const exclusion = extra?.collaboratorExclusion && extra.collaboratorExclusion.excludeIds.length > 0 ? extra.collaboratorExclusion : null;
  if (exclusion) {
    // Unused (null) args are OMITTED, never sent as an explicit null — see the note above this function.
    const filterArgs: Record<string, string | string[]> = { p_exclude_ids: [...exclusion.excludeIds] };
    if (exclusion.includeIds && exclusion.includeIds.length > 0) filterArgs.p_include_ids = [...exclusion.includeIds];

    if (scope?.restrictToSelf) {
      if (!scope.userId) {
        throw new Error("visibleLeadsBase: scope.restrictToSelf requires scope.userId");
      }
      const params: Record<string, string | string[]> = { p_tenant: tenantId, p_user: scope.userId, p_scope: "own", ...filterArgs };
      if (scope.userBranchId) params.p_user_branch_id = scope.userBranchId;
      if (scope.crossBranchPoolListSlug) params.p_cross_pool_slug = scope.crossBranchPoolListSlug;
      return clients.user.rpc("leads_visible_to_user_with_collaborator_filter", params, rpcOpts);
    }
    if (scope?.branchId) {
      return clients.user.rpc(
        "leads_visible_to_user_with_collaborator_filter",
        { p_tenant: tenantId, p_scope: "branch", p_branch_id: scope.branchId, ...filterArgs },
        rpcOpts,
      );
    }
    return clients.service.rpc("leads_for_tenant_with_collaborator_filter", { p_tenant: tenantId, ...filterArgs }, rpcOpts);
  }

  const collaboratorIds = extra?.collaboratorIds && extra.collaboratorIds.length > 0 ? [...extra.collaboratorIds] : null;
  // Same arguments either way — the collaborators variant only adds p_collaborator_ids.
  const rpcName = collaboratorIds ? "leads_visible_to_user_with_collaborators" : "leads_visible_to_user";
  if (scope?.restrictToSelf) {
    // Fail closed: restrictToSelf with no userId must never fall through to the
    // unrestricted tenant-wide query below — that would leak the whole tenant to a
    // counselor-scope viewer. This is a caller contract violation, not live input;
    // throwing surfaces the bug immediately instead of silently over-widening.
    if (!scope.userId) {
      throw new Error("visibleLeadsBase: scope.restrictToSelf requires scope.userId");
    }
    const params: Record<string, string | string[]> = {
      p_tenant: tenantId,
      p_user: scope.userId,
      p_scope: "own",
    };
    if (scope.userBranchId) params.p_user_branch_id = scope.userBranchId;
    if (scope.crossBranchPoolListSlug) params.p_cross_pool_slug = scope.crossBranchPoolListSlug;
    if (collaboratorIds) params.p_collaborator_ids = collaboratorIds;
    return clients.user.rpc(rpcName, params, rpcOpts);
  }
  if (scope?.branchId) {
    return clients.user.rpc(rpcName, {
      p_tenant: tenantId,
      p_scope: "branch",
      p_branch_id: scope.branchId,
      ...(collaboratorIds ? { p_collaborator_ids: collaboratorIds } : {}),
    }, rpcOpts);
  }
  return clients.service.from("leads").select("*", rpcOpts).eq("tenant_id", tenantId);
}
