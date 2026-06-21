import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { checkInMeta } from "../_shared/features/check-in/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { contactsMeta } from "./features/contacts/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { insightsMeta } from "./features/insights/meta";
import { campaignsMeta } from "./features/campaigns/meta";
import { applicationTrackingMeta } from "./features/application-tracking/meta";
import { leadListsMeta } from "../_shared/features/lead-lists/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.EDUCATION_CONSULTANCY,
  features: [
    { meta: insightsMeta },
    { meta: checkInMeta },
    { meta: formBuilderMeta },
    { meta: contactsMeta },
    { meta: emailMeta },
    { meta: campaignsMeta },
    { meta: applicationTrackingMeta },
    { meta: leadListsMeta },
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
    // Contacts sidebar item removed for education_consultancy — /contacts redirects to
    // /leads?list=prospects now that lead-lists is active.
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
    {
      featureId: FEATURES.CAMPAIGNS,
      href: "/campaigns",
      label: "Campaigns",
      icon: "Megaphone",
      minRoles: ["owner", "admin"],
    },
    {
      featureId: FEATURES.APPLICATION_TRACKING,
      href: "/applications",
      label: "Applications",
      icon: "GraduationCap",
    },
  ],
  ai: aiConfig,
};
