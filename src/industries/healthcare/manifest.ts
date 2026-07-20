import { INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { emailMeta } from "../_shared/features/email/meta";

// No tenants today.
export const manifest: IndustryManifest = {
  id: INDUSTRIES.HEALTHCARE,
  features: [{ meta: emailMeta }],
  sidebar: [],
  ai: {},
};
