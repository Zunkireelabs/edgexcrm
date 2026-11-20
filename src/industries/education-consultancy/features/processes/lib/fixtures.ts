import type { BaselineSetup } from "./baseline";
import type { RawMetrics } from "./metrics";

/** Admizz-shaped setup (real positions + stage names, A3d learned set: Counselors + Lead Executives). */
export const ADMIZZ_SETUP: BaselineSetup = {
  tenantName: "Admizz Education",
  firstTouchPositions: [
    { slug: "counselor", name: "Counselor" },
    { slug: "lead-executive", name: "Lead Executive" },
  ],
  stageNames: { qualified: "Qualified", enrolled: "Enrolled" },
};

/** The real Admizz numbers the lead quoted for 8 Oct-7 Nov 2026 (brief section 3). */
export const ADMIZZ_NEW_LEAD_RAW: RawMetrics = {
  arrived: 131,
  by_source: [
    { medium: null, n: 98 },
    { medium: "event page", n: 14 },
    { medium: "staff", n: 9 },
    { medium: "check-in", n: 8 },
    { medium: "a", n: 1 },
    { medium: "b", n: 1 },
  ],
  outside_office_hours: 62,
  owner_assigned: 117,
  owner_within_5min: 17,
  owner_wait_median_min: 114,
  owner_wait_p75_min: 522,
  contacted: 125,
  within_1h: 22,
  within_1wh: 31, // migration 287; NOT a quoted figure, a plausible value so the registry tests have a denominator-backed fraction
  first_contact_median_min: 852,
  never: 6,
  callbacks_booked: 78,
  callbacks_kept: 6,
  reached_qualified: 85,
  drops_with_reason: null,
  reason_field_missing: true,
};
