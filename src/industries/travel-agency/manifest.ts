import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { itineraryMeta } from "./features/itinerary/meta";
import { formBuilderMeta } from "../_shared/features/form-builder/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.TRAVEL_AGENCY,
  features: [{ meta: itineraryMeta }, { meta: formBuilderMeta }],
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
  ],
  ai: aiConfig,
};
