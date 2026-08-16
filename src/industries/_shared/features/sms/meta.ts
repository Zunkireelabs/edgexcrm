import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

// Shared folder, not education-only: other tenants buy this later, and
// promoting after the fact is the thing the architecture doc tells us to
// avoid (docs/SMS-PHASE3A-BRIEF.md §2).
export const smsMeta: FeatureMeta = {
  id: FEATURES.SMS,
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
};
