import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { emailMeta } from "../_shared/features/email/meta";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.CONSTRUCTION,
  features: [{ meta: formBuilderMeta }, { meta: emailMeta }],
  sidebar: [
    { featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: "FileText" },
  ],
  ai: {},
};
