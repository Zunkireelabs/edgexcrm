import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { emailMeta } from "../_shared/features/email/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";

// "General" is an explicit industry for tenants with no vertical (e.g. Zennly).
// It only opts into shared features: email, form builder.
export const manifest: IndustryManifest = {
  id: INDUSTRIES.GENERAL,
  features: [{ meta: emailMeta }, { meta: formBuilderMeta }],
  sidebar: [
    { featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: "FileText" },
  ],
  ai: {},
};

// Fallback for tenants whose `industry_id` is NULL or unknown. Deliberately
// bare (email only) so opting `general` into a feature never silently turns it
// on for tenants that never chose an industry. Keeps `id: GENERAL` so shared
// feature metas that list `general` (email) still resolve for them.
export const fallbackManifest: IndustryManifest = {
  id: INDUSTRIES.GENERAL,
  features: [{ meta: emailMeta }],
  sidebar: [],
  ai: {},
};
