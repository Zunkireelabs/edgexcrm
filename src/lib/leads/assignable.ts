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

  // Every chain/branch-scoped dropdown also always offers admin/owner and the
  // scoped branch's branch-manager(s), so a frontline holder can always escalate
  // up the chain instead of being limited strictly to same-position peers.
  const withAlwaysAdminsAndManager = (candidates: T[]): T[] => {
    if (opts.industryId !== "education_consultancy") return candidates;
    const seen = new Set(candidates.map((m) => m.user_id));
    const extras = members.filter(
      (m) =>
        !seen.has(m.user_id) &&
        (m.role === "admin" ||
          m.role === "owner" ||
          (m.position_slug === "branch-manager" && (m.branch_id ?? null) === (opts.branchId ?? null))),
    );
    return [...candidates, ...extras];
  };

  const sameBranch = (m: T) => (m.branch_id ?? null) === (opts.branchId ?? null);
  if (opts.leadScope === "team") {
    // Branch managers route leads to their team, but can also take a lead
    // themselves — self is a valid target, not excluded.
    const branchMembers = members.filter(sameBranch);
    return withAlwaysAdminsAndManager(branchMembers);
  }
  const isChain =
    opts.industryId === "education_consultancy" &&
    opts.positionSlug != null &&
    ASSIGN_CHAIN_POSITIONS.has(opts.positionSlug);
  if (isChain) {
    // Same-position peers, plus admin/owner/scoped branch-manager (see above).
    // Next-position users appear only in the "Send to next" assignment picker.
    const peers = new Set(peerSlugs(opts.positionSlug));
    const byPos = members.filter((m) => peers.has(m.position_slug ?? ""));
    const scoped = opts.branchId == null ? byPos : byPos.filter(sameBranch);
    return withAlwaysAdminsAndManager(scoped);
  }
  return withAlwaysAdminsAndManager(filterAssignableMembers(members, opts.leadScope, opts.branchId)); // non-chain fallback
}
