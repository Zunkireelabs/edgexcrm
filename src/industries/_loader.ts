/**
 * Manifest reader + gate truth + sidebar nav builder.
 *
 * Industry-scoped features (sidebar, route pages, API routes) all call
 * `getFeatureAccess(industryId, featureId)` to decide whether to render
 * or 403. The same function is the single enforcement point — change
 * the answer here and it propagates everywhere.
 */

import type { IndustryId } from "./_registry";
import type { IndustryManifest, SidebarItem } from "./_types";

import { manifest as educationConsultancyManifest } from "./education-consultancy/manifest";
import { manifest as itAgencyManifest } from "./it-agency/manifest";
import { manifest as constructionManifest } from "./construction/manifest";
import { manifest as realEstateManifest } from "./real-estate/manifest";
import { manifest as healthcareManifest } from "./healthcare/manifest";
import { manifest as recruitmentManifest } from "./recruitment/manifest";
import { manifest as generalManifest } from "./general/manifest";

const MANIFESTS: Record<IndustryId, IndustryManifest> = {
  education_consultancy: educationConsultancyManifest,
  it_agency: itAgencyManifest,
  construction: constructionManifest,
  real_estate: realEstateManifest,
  healthcare: healthcareManifest,
  recruitment: recruitmentManifest,
  general: generalManifest,
};

export function getManifest(industryId: string | null | undefined): IndustryManifest | null {
  if (!industryId) return null;
  return MANIFESTS[industryId as IndustryId] ?? null;
}

/**
 * The gate. Returns true if the tenant's industry has registered this
 * feature in its manifest. Used by route shells (page-level), API
 * routes (request-level), and the sidebar (render-level).
 */
export function getFeatureAccess(
  industryId: string | null | undefined,
  featureId: string,
): boolean {
  const m = getManifest(industryId);
  if (!m) return false;
  return m.features.some((f) => f.meta.id === featureId);
}

/**
 * Returns sidebar entries contributed by the tenant's industry. The
 * dashboard shell merges these with the universal nav items.
 */
export function getIndustrySidebarItems(
  industryId: string | null | undefined,
): readonly SidebarItem[] {
  const m = getManifest(industryId);
  return m?.sidebar ?? [];
}

/**
 * Resolves the per-industry config object for a feature, if any. Used
 * by shared feature implementations that need to behave per-industry
 * (different labels, limits, templates).
 */
export function getFeatureConfig<TConfig = unknown>(
  industryId: string | null | undefined,
  featureId: string,
): TConfig | undefined {
  const m = getManifest(industryId);
  if (!m) return undefined;
  const reg = m.features.find((f) => f.meta.id === featureId);
  return (reg?.config as TConfig | undefined) ?? (reg?.meta.defaultConfig as TConfig | undefined);
}
