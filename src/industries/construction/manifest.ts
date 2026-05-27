import { INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";

// No tenants today. Stub kept so the loader can resolve the manifest
// when a construction tenant is created.
export const manifest: IndustryManifest = {
  id: INDUSTRIES.CONSTRUCTION,
  features: [],
  sidebar: [],
  ai: {},
};
