/**
 * Industry gating helper for API routes that don't go through the
 * page-shell loader path.
 *
 * For industry-scoped features, prefer the loader pattern (the route
 * shell calls `getFeatureAccess()` from `src/industries/_loader.ts`).
 * Use `requireIndustry()` for endpoints that are "industry-aware but
 * not feature-bound" — for example, an analytics endpoint that
 * surfaces extra fields only for one industry.
 */

import type { AuthContext } from "@/lib/api/auth";

/**
 * Returns true when the authenticated user's tenant belongs to one of
 * the listed industries. Returns false for tenants with no industry.
 */
export function requireIndustry(auth: AuthContext, ...industries: string[]): boolean {
  if (!auth.industryId) return false;
  return industries.includes(auth.industryId);
}
