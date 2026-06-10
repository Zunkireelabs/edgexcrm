import { INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.TRAVEL_AGENCY,
  features: [],
  sidebar: [],
  ai: aiConfig,
};
