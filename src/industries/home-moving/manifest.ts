import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { offeringsMeta } from "../real-estate/features/offerings/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { aiConfig } from "../real-estate/ai/agent";

/**
 * home_moving — literal clone of the real_estate capital-raise workspace.
 *
 * Deliberately identical to real-estate/manifest.ts: same offeringsMeta
 * (imported from the real-estate folder — not yet promoted to _shared,
 * see the comment on offeringsMeta.industries), same sidebar labels
 * ("Offerings"/"Investors"/"Data Room"), same AI tool pack/prompt. No
 * home-moving-specific customization in this pass; a later pass may add
 * per-industry label overrides via manifest `config`.
 */
export const manifest: IndustryManifest = {
  id: INDUSTRIES.HOME_MOVING,
  features: [{ meta: offeringsMeta }, { meta: emailMeta }],
  sidebar: [
    {
      featureId: FEATURES.OFFERINGS,
      href: "/offerings",
      label: "Offerings",
      icon: "Building2",
      position: "before-pipeline",
    },
    {
      featureId: FEATURES.OFFERINGS,
      href: "/data-room",
      label: "Data Room",
      icon: "FolderOpen",
      position: "after-pipeline",
    },
  ],
  ai: aiConfig,
};
