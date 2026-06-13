import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { checkInMeta } from "./features/check-in/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { contactsMeta } from "./features/contacts/meta";
import { emailMeta } from "./features/email/meta";
import { insightsMeta } from "./features/insights/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.EDUCATION_CONSULTANCY,
  features: [
    { meta: insightsMeta },
    { meta: checkInMeta },
    { meta: formBuilderMeta },
    { meta: contactsMeta },
    { meta: emailMeta },
  ],
  sidebar: [
    {
      kind: "group",
      position: "after-home",
      id: "insights",
      label: "Insights",
      icon: "ChartColumn",
      children: [
        { featureId: FEATURES.INSIGHTS, href: "/insights/dashboards", label: "Dashboards", icon: "LayoutDashboard" },
      ],
    },
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
