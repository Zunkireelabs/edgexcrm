import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { offeringsMeta } from "./features/offerings/meta";
import { aiConfig } from "./ai/agent";

/**
 * real_estate — CRE sponsor / capital-raise workspace.
 *
 * Two surfaces:
 *   - Investors = the universal `/leads` route, relabeled "Investors" for
 *     real_estate in the dashboard shell (no separate sidebar item — the
 *     universal leads nav is reused; see shell.tsx isRealEstate branch).
 *   - Offerings = this industry-scoped feature (capital-raise vehicles),
 *     each opening a per-offering raise funnel driven by investor_commitments.
 *
 * Icons are string names resolved by INDUSTRY_ICONS in shell.tsx
 * (Building2 already registered). Non-education/it_agency industries render
 * their sidebar generically from these entries (manifest-driven).
 */
export const manifest: IndustryManifest = {
  id: INDUSTRIES.REAL_ESTATE,
  features: [{ meta: offeringsMeta }],
  sidebar: [
    {
      featureId: FEATURES.OFFERINGS,
      href: "/offerings",
      label: "Offerings",
      icon: "Building2",
      position: "before-pipeline",
    },
    {
      // Per-offering data room (Phase 1.6). Lives under the OFFERINGS feature —
      // rendered in the shell's isRealEstate branch via reItem("/data-room").
      featureId: FEATURES.OFFERINGS,
      href: "/data-room",
      label: "Data Room",
      icon: "FolderOpen",
      position: "after-pipeline",
    },
  ],
  ai: aiConfig,
};
