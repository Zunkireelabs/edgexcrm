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
