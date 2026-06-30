import { ASSIGN_CHAIN_POSITIONS, assignableTargetSlugs } from "@/industries/education-consultancy/lead-assignment-chain";

/**
 * Branch-scoping for "assign a user" dropdowns.
 *
 * Rule (per product): a branch-scoped user (leadScope !== "all" — e.g. Branch
 * Manager, Counselor) may only assign to members of *their own branch*. A user
 * with overall access (owner/admin, leadScope === "all") sees every member.
 *
 * Matches by exact branch_id (null matches null), so a no-branch user sees only
 * other no-branch members.
 */
export function filterAssignableMembers<T extends { branch_id?: string | null }>(
  members: T[],
  leadScope: "all" | "own" | "team",
  branchId: string | null,
): T[] {
  if (leadScope === "all") return members;
  return members.filter((m) => (m.branch_id ?? null) === (branchId ?? null));
}

/**
 * Position-chain scoping for assign dropdowns (education_consultancy).
 *
 * owner/admin → everyone; branch manager (leadScope "team") → same branch;
 * chain position → peers + next funnel position, same branch (org-wide if actor has no branch).
 * Non-chain positions fall back to the original branch filter.
 */
export function filterAssignableMembersByChain<
  T extends { branch_id?: string | null; position_slug?: string | null }
>(
  members: T[],
  opts: {
    baseTier: string;
    leadScope: "all" | "own" | "team";
    branchId: string | null;
    positionSlug: string | null;
    industryId: string | null;
  },
): T[] {
  if (opts.baseTier === "owner" || opts.baseTier === "admin") return members;
  const sameBranch = (m: T) => (m.branch_id ?? null) === (opts.branchId ?? null);
  if (opts.leadScope === "team") return members.filter(sameBranch); // branch manager
  const isChain =
    opts.industryId === "education_consultancy" &&
    opts.positionSlug != null &&
    ASSIGN_CHAIN_POSITIONS.has(opts.positionSlug);
  if (isChain) {
    const targets = new Set(assignableTargetSlugs(opts.positionSlug));
    const byPos = members.filter((m) => targets.has(m.position_slug ?? ""));
    return opts.branchId == null ? byPos : byPos.filter(sameBranch); // no-branch ⇒ org-wide
  }
  return filterAssignableMembers(members, opts.leadScope, opts.branchId); // non-chain fallback
}
