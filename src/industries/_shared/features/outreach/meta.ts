import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

export const outreachMeta: FeatureMeta = {
  id: FEATURES.OUTREACH,
  // Promoted to education_consultancy for Outreach Phase 2 (drip sequences +
  // auto-send, OUTREACH-PHASE2-BRIEF.md). it_agency keeps the exact
  // manual-copy model it always had — auto_send is a per-sequence flag, not
  // an industry gate, so this list only controls feature *visibility*.
  industries: [INDUSTRIES.IT_AGENCY, INDUSTRIES.EDUCATION_CONSULTANCY],
};
