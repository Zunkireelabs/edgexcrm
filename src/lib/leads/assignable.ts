import { ASSIGN_CHAIN_POSITIONS, peerSlugs } from "@/industries/education-consultancy/lead-assignment-chain";

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
 *
 * Admins are always a valid assignee (education_consultancy only) — appended last,
 * after whichever scoping rule above ran, so they're never excluded by branch/chain.
 */
export function filterAssignableMembersByChain<
  T extends { branch_id?: string | null; position_slug?: string | null; user_id?: string; role?: string | null }
>(
  members: T[],
  opts: {
    baseTier: string;
    leadScope: "all" | "own" | "team";
    branchId: string | null;
    positionSlug: string | null;
    industryId: string | null;
    selfUserId?: string | null;
  },
): T[] {
  if (opts.baseTier === "owner" || opts.baseTier === "admin") return members;

  const withAlwaysAdmins = (candidates: T[]): T[] => {
    if (opts.industryId !== "education_consultancy") return candidates;
    const seen = new Set(candidates.map((m) => m.user_id));
    const admins = members.filter((m) => m.role === "admin" && !seen.has(m.user_id));
    return [...candidates, ...admins];
  };

  const sameBranch = (m: T) => (m.branch_id ?? null) === (opts.branchId ?? null);
  if (opts.leadScope === "team") {
    // Branch managers route leads — exclude themselves from the assignable list
    const branchMembers = members.filter(sameBranch);
    const scoped = opts.selfUserId ? branchMembers.filter((m) => m.user_id !== opts.selfUserId) : branchMembers;
    return withAlwaysAdmins(scoped);
  }
  const isChain =
    opts.industryId === "education_consultancy" &&
    opts.positionSlug != null &&
    ASSIGN_CHAIN_POSITIONS.has(opts.positionSlug);
  if (isChain) {
    // Only show same-position peers in the Assigned To dropdown.
    // Next-position users appear only in the "Send to next" assignment picker.
    const peers = new Set(peerSlugs(opts.positionSlug));
    const byPos = members.filter((m) => peers.has(m.position_slug ?? ""));
    const scoped = opts.branchId == null ? byPos : byPos.filter(sameBranch);
    return withAlwaysAdmins(scoped);
  }
  return withAlwaysAdmins(filterAssignableMembers(members, opts.leadScope, opts.branchId)); // non-chain fallback
}
