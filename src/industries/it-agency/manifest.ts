import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { accountsMeta } from "./features/accounts/meta";
import { timeTrackingMeta } from "./features/time-tracking/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.IT_AGENCY,
  features: [{ meta: accountsMeta }, { meta: timeTrackingMeta }],
  sidebar: [
    {
      featureId: FEATURES.ACCOUNTS,
      href: "/accounts",
      label: "Accounts",
      icon: "Building2",
    },
    {
      featureId: FEATURES.TIME_TRACKING,
      href: "/time-tracking",
      label: "Time Tracking",
      icon: "Clock",
    },
  ],
  ai: aiConfig,
};
