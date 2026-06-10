import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { itineraryMeta } from "./features/itinerary/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.TRAVEL_AGENCY,
  features: [{ meta: itineraryMeta }],
  sidebar: [
    {
      featureId: FEATURES.ITINERARY,
      href: "/itineraries",
      label: "Itineraries",
      icon: "Plane",
    },
  ],
  ai: aiConfig,
};
