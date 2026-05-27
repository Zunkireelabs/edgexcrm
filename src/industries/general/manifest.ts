import { INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";

// "General" is the fallback industry — no industry-specific features
// by definition. Tenants without an `industry_id` should be assigned
// this rather than left null.
export const manifest: IndustryManifest = {
  id: INDUSTRIES.GENERAL,
  features: [],
  sidebar: [],
  ai: {},
};
