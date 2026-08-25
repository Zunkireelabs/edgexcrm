import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { checkInMeta } from "../_shared/features/check-in/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { contactsMeta } from "./features/contacts/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { insightsMeta } from "../_shared/features/insights/meta";
import { campaignsMeta } from "./features/campaigns/meta";
import { applicationTrackingMeta } from "./features/application-tracking/meta";
import { leadListsMeta } from "../_shared/features/lead-lists/meta";
import { classesMeta } from "./features/classes/meta";
import { affiliatesMeta } from "./features/affiliates/meta";
import { smsMeta } from "../_shared/features/sms/meta";
import { emailCampaignsMeta } from "../_shared/features/email-campaigns/meta";
import { outreachMeta } from "../_shared/features/outreach/meta";
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
    { meta: classesMeta },
    { meta: affiliatesMeta },
    { meta: smsMeta },
    { meta: emailCampaignsMeta },
    { meta: outreachMeta },
  ],
  sidebar: [
    // Intelligence section
    { featureId: FEATURES.INSIGHTS, href: "/insights/dashboards", label: "Dashboards", icon: "LayoutDashboard" },
    // Operations section
    { featureId: FEATURES.APPLICATION_TRACKING, href: "/applications", label: "Applications", icon: "GraduationCap" },
    { featureId: FEATURES.CLASSES, href: "/classes", label: "Classes", icon: "BookOpen" },
    { featureId: FEATURES.CHECK_IN, href: "/check-in", label: "Check-In", icon: "UserCheck", allowedPositions: ["lead-executive", "branch-manager"] },
    // Marketing section
    { featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: "FileText" },
    { featureId: FEATURES.CAMPAIGNS, href: "/campaigns", label: "Campaigns", icon: "Megaphone", minRoles: ["owner", "admin"] },
    { featureId: FEATURES.SMS, href: "/sms", label: "SMS", icon: "MessageSquare", minRoles: ["owner", "admin"], entitlement: "sms_enabled" },
    { featureId: FEATURES.EMAIL_CAMPAIGNS, href: "/email-campaigns", label: "Email Campaigns", icon: "Mail", minRoles: ["owner", "admin"] },
    { featureId: FEATURES.OUTREACH, href: "/outreach", label: "Outreach", icon: "Send" },
  ],
  ai: aiConfig,
};
