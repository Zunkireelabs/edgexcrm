import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Resolves which branch a newly-created lead should be attributed to.
 *
 * Precedence: 1. explicit request branch_id  2. active-branch cookie
 * (dashboard only)  3. the caller's own branch (dashboard only)  4. the
 * form's own default branch (form_configs.attribution.default_branch_id)
 * 5. the tenant's default branch (is_default = true).
 *
 * Steps 1–4 are resolved by the caller (route.ts) since they depend on
 * request context — cookies, session auth, the fetched form config. This
 * function's job is just the final tenant-default DB fallback, so the
 * whole precedence chain is exercised as one pure, testable unit.
 *
 * Step 4 exists because a public widget submission (the common case — no
 * session, no cookie) has no way to say which branch it's from. A form
 * embedded on a branch-specific landing page can carry that as its own
 * routing default instead of every public submission silently landing on
 * the tenant's one default branch.
 */
export async function resolveLeadBranch(
  supabase: SupabaseServiceClient,
  args: {
    tenantId: string;
    explicitBranchId?: string | null;
    cookieBranchId?: string | null;
    callerBranchId?: string | null;
    formDefaultBranchId?: string | null;
  }
): Promise<string | null> {
  const resolved =
    args.explicitBranchId ?? args.cookieBranchId ?? args.callerBranchId ?? args.formDefaultBranchId ?? null;
  if (resolved) return resolved;

  const { data: defaultBranch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  return defaultBranch?.id ?? null;
}

/**
 * A lead that lands in the tenant's DEFAULT branch (the "Global" inbox) has no team yet. When it is
 * assigned to someone who belongs to a branch, it becomes that branch's lead: leads.branch_id moves
 * to the assignee's branch (and the origin lead_branches row follows, via syncOriginMembership).
 *
 * Only leads sitting in the default branch move — a lead already in KTM / Birgunj / Janakpur keeps
 * its branch when reassigned, exactly as before. An assignee with no branch (owner / admin) leaves
 * the lead where it is. Returns null when there is nothing to move TO for this assignee, so callers
 * can skip the per-lead check entirely.
 *
 * `knownAssigneeBranchId` lets a caller that already read the assignee's tenant_users row skip the
 * second read (`undefined` = look it up).
 */
export async function assignmentBranchTarget(
  supabase: SupabaseServiceClient,
  tenantId: string,
  assigneeId: string,
  knownAssigneeBranchId?: string | null,
): Promise<{ fromBranchId: string; toBranchId: string } | null> {
  let toBranchId = knownAssigneeBranchId;
  if (toBranchId === undefined) {
    const { data } = await supabase
      .from("tenant_users")
      .select("branch_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", assigneeId)
      .maybeSingle();
    toBranchId = (data as { branch_id: string | null } | null)?.branch_id ?? null;
  }
  if (!toBranchId) return null;

  const { data: defaultBranch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  const fromBranchId = (defaultBranch as { id: string } | null)?.id ?? null;
  if (!fromBranchId || fromBranchId === toBranchId) return null;
  return { fromBranchId, toBranchId };
}

/** The branch a lead should move to on assignment, or null to leave it alone. */
export function branchMoveOnAssignment(
  currentBranchId: string | null | undefined,
  target: { fromBranchId: string; toBranchId: string } | null,
): string | null {
  return target && currentBranchId === target.fromBranchId ? target.toBranchId : null;
}
