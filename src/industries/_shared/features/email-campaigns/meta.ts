import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

// Shared folder, not education-only: other tenants buy this later, and
// promoting after the fact is the thing the architecture doc tells us to
// avoid (docs/OUTREACH-PHASE1-BRIEF.md §7.1) — same precedent as sms/meta.ts.
export const emailCampaignsMeta: FeatureMeta = {
  id: FEATURES.EMAIL_CAMPAIGNS,
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
};
