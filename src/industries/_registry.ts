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
  // Industry-scoped (it_agency)
  TIME_TRACKING: "time-tracking",
  ACCOUNTS: "accounts",
  CRM_CONTACTS: "crm-contacts",
  PROJECT_BOARD: "project-board",
} as const;

export type FeatureId = (typeof FEATURES)[keyof typeof FEATURES];
