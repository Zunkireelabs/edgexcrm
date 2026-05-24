import { INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";

// IT agency tenants currently use only universal CRM features.
// Industry-specific features for IT will land here as they ship.
export const manifest: IndustryManifest = {
  id: INDUSTRIES.IT_AGENCY,
  features: [],
  sidebar: [],
  ai: {},
};
