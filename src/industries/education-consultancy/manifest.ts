import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { checkInMeta } from "./features/check-in/meta";
import { formBuilderMeta } from "./features/form-builder/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.EDUCATION_CONSULTANCY,
  features: [
    { meta: checkInMeta },
    { meta: formBuilderMeta },
  ],
  sidebar: [
    {
      featureId: FEATURES.CHECK_IN,
      href: "/check-in",
      label: "Check-In",
      icon: "UserCheck",
    },
    {
      featureId: FEATURES.FORM_BUILDER,
      href: "/forms",
      label: "Forms",
      icon: "FileText",
    },
  ],
  ai: aiConfig,
};
