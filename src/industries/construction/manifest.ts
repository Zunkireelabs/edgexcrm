import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { smsMeta } from "../_shared/features/sms/meta";
import { emailCampaignsMeta } from "../_shared/features/email-campaigns/meta";
import { outreachMeta } from "../_shared/features/outreach/meta";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.CONSTRUCTION,
  features: [
    { meta: formBuilderMeta },
    { meta: emailMeta },
    { meta: smsMeta },
    { meta: emailCampaignsMeta },
    { meta: outreachMeta },
  ],
  sidebar: [
    // Marketing section
    { featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: "FileText" },
    { featureId: FEATURES.SMS, href: "/sms", label: "SMS", icon: "MessageSquare", minRoles: ["owner", "admin"], entitlement: "sms_enabled" },
    { featureId: FEATURES.EMAIL_CAMPAIGNS, href: "/email-campaigns", label: "Email Campaigns", icon: "Mail", minRoles: ["owner", "admin"] },
    { featureId: FEATURES.OUTREACH, href: "/outreach", label: "Outreach", icon: "Send" },
  ],
  ai: {},
};
