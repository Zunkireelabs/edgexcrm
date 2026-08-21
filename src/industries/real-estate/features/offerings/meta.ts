import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

export const offeringsMeta: FeatureMeta = {
  id: FEATURES.OFFERINGS,
  // home_moving is a literal clone of the real_estate capital-raise vertical
  // (offerings/investor_commitments/data-room) — see manifest.ts in each
  // industry folder. Same feature, same tables, same UI; no per-industry
  // config yet (a later pass may add label overrides).
  industries: [INDUSTRIES.REAL_ESTATE, INDUSTRIES.HOME_MOVING],
};
