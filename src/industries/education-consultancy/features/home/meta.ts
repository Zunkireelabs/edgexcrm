import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

/** The education Home ("Do next"). No sidebar item: Home already exists; page.tsx switches on industry. */
export const eduHomeMeta: FeatureMeta = {
  id: FEATURES.EDU_HOME,
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
};
