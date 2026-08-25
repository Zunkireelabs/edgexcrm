/**
 * Single source of truth for industry IDs and feature IDs.
 *
 * Every manifest references these constants instead of raw strings,
 * so TypeScript catches typos at compile time. To add a new feature
 * or industry, update the relevant constant here first, then add the
 * feature implementation + manifest entry.
 *
 * See docs/FEATURE-CATALOG.md for the human-readable view of which
 * industries use which features today.
 */

// Industry IDs map 1:1 to rows in the `industries` table in the DB
// (see supabase/migrations/012_industry_customization.sql).
export const INDUSTRIES = {
  EDUCATION_CONSULTANCY: "education_consultancy",
  IT_AGENCY: "it_agency",
  CONSTRUCTION: "construction",
  REAL_ESTATE: "real_estate",
  HEALTHCARE: "healthcare",
  RECRUITMENT: "recruitment",
  GENERAL: "general",
  TRAVEL_AGENCY: "travel_agency",
  HOME_MOVING: "home_moving",
} as const;

export type IndustryId = (typeof INDUSTRIES)[keyof typeof INDUSTRIES];

// Feature IDs — one entry per industry-scoped or shared feature.
// Universal features (leads, pipeline, team, settings) are NOT listed
// here; they live outside the industry layer and need no registration.
export const FEATURES = {
  // Industry-scoped (education_consultancy)
  CHECK_IN: "check-in",
  FORM_BUILDER: "form-builder",
  CONTACTS: "contacts",
  EMAIL: "email",
  INSIGHTS: "insights",
  CAMPAIGNS: "campaigns",
  APPLICATION_TRACKING: "application-tracking",
  LEAD_LISTS: "lead-lists",
  CLASSES: "classes",
  // Industry-scoped (it_agency)
  TIME_TRACKING: "time-tracking",
  ACCOUNTS: "accounts",
  CRM_CONTACTS: "crm-contacts",
  PROJECT_BOARD: "project-board",
  DEALS: "deals",
  SERVICES: "services",
  PROPOSALS: "proposals",
  // Industry-scoped (travel_agency)
  TRIP_INQUIRY: "trip-inquiry",
  ITINERARY: "itinerary",
  // Industry-scoped (real_estate) — CRE capital-raise vertical
  OFFERINGS: "offerings",
  // Industry-scoped (it_agency) — HRMS Phase 1 Resourcing edge
  RESOURCING: "resourcing",
  // Industry-scoped (education_consultancy)
  AFFILIATES: "affiliates",
  // Industry-scoped (it_agency) — email sequencing / cadence engine
  OUTREACH: "outreach",
  // Shared (education_consultancy today; other tenants buy this later — see
  // docs/SMS-PHASE3A-BRIEF.md §2). Never call this "campaigns" — that name is
  // already taken by the education referral/leaderboard feature.
  SMS: "sms",
  // Shared (education_consultancy today; other tenants buy this later — see
  // docs/OUTREACH-PHASE1-BRIEF.md §7.1/§7.3). The Brevo-replacement email
  // blast surface. Also never called "campaigns" for the same reason as SMS
  // above — route is /email-campaigns, provisional naming pending Sadin.
  EMAIL_CAMPAIGNS: "email-campaigns",
} as const;

export type FeatureId = (typeof FEATURES)[keyof typeof FEATURES];
