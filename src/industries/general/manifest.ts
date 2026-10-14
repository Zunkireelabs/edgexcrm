import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { emailMeta } from "../_shared/features/email/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";

// "General" is the fallback industry — no industry-specific features
// by definition (it only opts into shared ones: email, form builder).
// Tenants without an `industry_id` should be assigned this rather than
// left null.
export const manifest: IndustryManifest = {
  id: INDUSTRIES.GENERAL,
  features: [{ meta: emailMeta }, { meta: formBuilderMeta }],
  sidebar: [
    { featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: "FileText" },
  ],
  ai: {},
};
