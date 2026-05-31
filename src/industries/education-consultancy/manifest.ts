import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { checkInMeta } from "./features/check-in/meta";
import { formBuilderMeta } from "./features/form-builder/meta";
import { contactsMeta } from "./features/contacts/meta";
import { emailMeta } from "./features/email/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.EDUCATION_CONSULTANCY,
  features: [
    { meta: checkInMeta },
    { meta: formBuilderMeta },
    { meta: contactsMeta },
    { meta: emailMeta },
  ],
  sidebar: [
    {
      featureId: FEATURES.CONTACTS,
      href: "/contacts",
      label: "Contacts",
      icon: "Users",
    },
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
