/**
 * Manifest reader + gate truth + sidebar nav builder.
 *
 * Industry-scoped features (sidebar, route pages, API routes) all call
 * `getFeatureAccess(industryId, featureId)` to decide whether to render
 * or 403. The same function is the single enforcement point — change
 * the answer here and it propagates everywhere.
 */

import { INDUSTRIES, type FeatureId, type IndustryId } from "./_registry";
import type { IndustryManifest, SidebarEntry, SidebarItem } from "./_types";
import { canSeeNav, type ResolvedPermissions } from "@/lib/api/permissions";

import { manifest as educationConsultancyManifest } from "./education-consultancy/manifest";
import { manifest as itAgencyManifest } from "./it-agency/manifest";
import { manifest as constructionManifest } from "./construction/manifest";
import { manifest as realEstateManifest } from "./real-estate/manifest";
import { manifest as healthcareManifest } from "./healthcare/manifest";
import { manifest as recruitmentManifest } from "./recruitment/manifest";
import { manifest as generalManifest } from "./general/manifest";
import { manifest as travelAgencyManifest } from "./travel-agency/manifest";

const MANIFESTS: Record<IndustryId, IndustryManifest> = {
  education_consultancy: educationConsultancyManifest,
  it_agency: itAgencyManifest,
  construction: constructionManifest,
  real_estate: realEstateManifest,
  healthcare: healthcareManifest,
  recruitment: recruitmentManifest,
  general: generalManifest,
  travel_agency: travelAgencyManifest,
};

/**
 * Resolve a tenant's industry to its manifest. Tenants without an
 * `industry_id` fall back to the `general` manifest (see
 * `src/industries/general/manifest.ts`) — never null. An unknown
 * `industry_id` (in DB but not in `_registry.ts`) also falls back to
 * `general` so legacy/forward-compat tenants aren't locked out
 * entirely; ideally that mismatch is flagged separately.
 */
export function getManifest(industryId: string | null | undefined): IndustryManifest {
  if (!industryId) return MANIFESTS[INDUSTRIES.GENERAL];
  return MANIFESTS[industryId as IndustryId] ?? MANIFESTS[INDUSTRIES.GENERAL];
}

/**
 * The gate. Returns true if the tenant's industry has registered this
 * feature in its manifest. Used by route shells (page-level), API
 * routes (request-level), and the sidebar (render-level).
 *
 * Accepts a typed FeatureId from `_registry.ts` so typos are caught at
 * compile time. A feature is "registered" when it appears in the
 * industry manifest's `features` array AND the feature's own meta
 * lists this industry — both checks guard against the dead-field bug
 * and against accidental cross-industry registration.
 */
export function getFeatureAccess(
  industryId: string | null | undefined,
  featureId: FeatureId,
): boolean {
  const m = getManifest(industryId);
  const reg = m.features.find((f) => f.meta.id === featureId);
  if (!reg) return false;
  // Defense in depth: even if the feature is in the manifest, its own
  // meta must claim this industry. Prevents accidental registration
  // of a feature in an industry its author didn't intend.
  return reg.meta.industries.includes(m.id);
}

/**
 * Returns sidebar entries contributed by the tenant's industry. The
 * dashboard shell merges these with the universal nav items. Filters
 * out items whose featureId is no longer registered (catches
 * sidebar/features drift inside a single manifest) and items whose
 * `minRoles` list does not include the current user's role.
 *
 * `role` is optional so callers without role context still work — they
 * receive unfiltered nav (role-gated items are included).
 */
export function getIndustrySidebarItems(
  industryId: string | null | undefined,
  role?: string,
  permissions?: ResolvedPermissions,
): readonly SidebarEntry[] {
  const m = getManifest(industryId);
  const registeredFeatureIds = new Set(m.features.map((f) => f.meta.id));

  // Always-viewable nav items: visible to every user in the industry regardless of
  // the position's allowedNavKeys / minRoles restrictions. Editing is still gated
  // downstream (e.g. classes manage/enroll buttons require canManageClasses), but
  // the page itself is view-only-accessible to everyone.
  const ALWAYS_VIEWABLE_HREFS = new Set(["/classes"]);

  function isItemAllowed(item: SidebarItem): boolean {
    if (!registeredFeatureIds.has(item.featureId)) return false;
    if (ALWAYS_VIEWABLE_HREFS.has(item.href)) return true;
    if (item.minRoles && (!role || !item.minRoles.includes(role as never))) return false;
    if (permissions && !canSeeNav(permissions, item.href)) return false;
    return true;
  }

  return m.sidebar.flatMap((entry): SidebarEntry[] => {
    if (entry.kind === "group") {
      const allowedChildren = entry.children.filter(isItemAllowed);
      if (allowedChildren.length === 0) return [];
      return [{ ...entry, children: allowedChildren }];
    }
    return isItemAllowed(entry) ? [entry] : [];
  });
}

/**
 * Resolves the per-industry config object for a feature, if any. Used
 * by shared feature implementations that need to behave per-industry
 * (different labels, limits, templates).
 */
export function getFeatureConfig<TConfig = unknown>(
  industryId: string | null | undefined,
  featureId: FeatureId,
): TConfig | undefined {
  const m = getManifest(industryId);
  const reg = m.features.find((f) => f.meta.id === featureId);
  return (reg?.config as TConfig | undefined) ?? (reg?.meta.defaultConfig as TConfig | undefined);
}
