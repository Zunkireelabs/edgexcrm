import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { itineraryMeta } from "./features/itinerary/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { checkInMeta } from "../_shared/features/check-in/meta";
import { leadListsMeta } from "../_shared/features/lead-lists/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.TRAVEL_AGENCY,
  features: [{ meta: itineraryMeta }, { meta: formBuilderMeta }, { meta: emailMeta }, { meta: checkInMeta }, { meta: leadListsMeta }],
  sidebar: [
    {
      featureId: FEATURES.ITINERARY,
      href: "/itineraries",
      label: "Itineraries",
      icon: "Plane",
    },
    {
      featureId: FEATURES.FORM_BUILDER,
      href: "/forms",
      label: "Forms",
      icon: "FileText",
    },
    {
      featureId: FEATURES.CHECK_IN,
      href: "/check-in",
      label: "Check-In",
      icon: "UserCheck",
    },
  ],
  ai: aiConfig,
};
