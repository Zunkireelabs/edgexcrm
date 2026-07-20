import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

export const emailMeta: FeatureMeta = {
  id: FEATURES.EMAIL,
  industries: [
    INDUSTRIES.EDUCATION_CONSULTANCY,
    INDUSTRIES.TRAVEL_AGENCY,
    INDUSTRIES.IT_AGENCY,
    INDUSTRIES.CONSTRUCTION,
    INDUSTRIES.REAL_ESTATE,
    INDUSTRIES.HEALTHCARE,
    INDUSTRIES.RECRUITMENT,
    INDUSTRIES.GENERAL,
  ],
};
