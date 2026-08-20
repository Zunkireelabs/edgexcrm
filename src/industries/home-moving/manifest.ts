import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { offeringsMeta } from "../real-estate/features/offerings/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { aiConfig } from "../real-estate/ai/agent";

/**
 * home_moving — literal clone of the real_estate capital-raise workspace,
 * plus Form Builder (a deliberate deviation — real_estate itself doesn't
 * have Form Builder; Home Moving needs a public lead-capture form and
 * Form Builder is already a _shared feature, so it opts in directly here
 * rather than being added to real_estate as a side effect).
 *
 * Otherwise deliberately identical to real-estate/manifest.ts: same
 * offeringsMeta (imported from the real-estate folder — not yet promoted
 * to _shared, see the comment on offeringsMeta.industries), same sidebar
 * labels ("Offerings"/"Investors"/"Data Room"), same AI tool pack/prompt.
 * No other home-moving-specific customization in this pass; a later pass
 * may add per-industry label overrides via manifest `config`.
 */
export const manifest: IndustryManifest = {
  id: INDUSTRIES.HOME_MOVING,
  features: [{ meta: offeringsMeta }, { meta: emailMeta }, { meta: formBuilderMeta }],
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
    {
      featureId: FEATURES.FORM_BUILDER,
      href: "/forms",
      label: "Forms",
      icon: "FileText",
      position: "before-pipeline",
    },
  ],
  ai: aiConfig,
};
