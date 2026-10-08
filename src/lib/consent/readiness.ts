import type { SupabaseClient } from "@supabase/supabase-js";
import { getLeadCity, getLeadNationality } from "@/lib/leads/lead-location";
import { logger } from "@/lib/logger";
import { resolveGuardian, GUARDIAN_NOT_APPLICABLE, normalizeGuardianRelationship } from "./guardian";

/**
 * Is a student's profile complete enough to generate a consent document?
 *
 * The consent text is written by an admin with `{{placeholders}}` (see merge.ts) and each is filled
 * from the student's profile — an empty one goes out as a blank line. So "complete" is driven by the
 * CURRENT template: name / email / phone / study info are always required, plus the profile field
 * behind every placeholder the template actually uses. Edit the template and the rule follows.
 *
 * Every placeholder in CONSENT_MERGE_FIELDS must be in exactly one of ALWAYS_REQUIRED_PLACEHOLDERS,
 * AUTOMATIC_PLACEHOLDERS or PLACEHOLDER_REQUIREMENTS — readiness.test.ts fails otherwise, so a new
 * placeholder can never silently go out blank.
 */

/** Missing fields grouped by the Student Details section they live in, in the pop-up's own order. */
export interface MissingGroup {
  section: string;
  fields: string[];
}

export interface ConsentReadiness {
  ready: boolean;
  /** Flat labels of what to fill in, e.g. ["Passport Number", "Father's Name"]. */
  missing: string[];
  /** The same fields grouped by section, so staff know WHERE in Student Details to fill each one. */
  groups: MissingGroup[];
}

// Section names match the Student Details pop-up, listed in the order it shows them.
const SECTION_ORDER = [
  "Personal Information",
  "Basic Details",
  "Guardian Details",
  "Passport & Citizenship",
  "Study Interest",
  "Assignment",
] as const;

export interface ConsentProfile {
  first_name: string | null;
  email: string | null;
  phone: string | null;
  field_of_study: string | null;
  degree_level: string | null;
  city: string | null;
  nationality: string | null;
  country: string | null;
  custom_fields: Record<string, unknown> | null;
  passport_number: string | null;
  full_address: string | null;
  father_name: string | null;
  mother_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  date_of_birth: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  guardian_relationship: string | null;
  guardian_name: string | null;
  /** The lead's assigned counselor (user id) — behind {{counselor_name}} / {{assign_name}}. */
  assigned_to: string | null;
}

/** Columns the check reads — keep in sync with ConsentProfile. */
export const CONSENT_PROFILE_COLUMNS =
  "first_name, email, phone, field_of_study, degree_level, city, nationality, country, custom_fields, passport_number, full_address, father_name, mother_name, emergency_contact_name, emergency_contact_phone, date_of_birth, guardian_phone, guardian_email, guardian_relationship, guardian_name, assigned_to";

const filled = (v: string | null | undefined) => !!v?.trim();

/** "None / Not applicable" guardian: the form prints N/A, so the guardian's own details aren't required. */
const noGuardian = (p: ConsentProfile) => normalizeGuardianRelationship(p.guardian_relationship) === GUARDIAN_NOT_APPLICABLE;
const effectiveGuardian = (p: ConsentProfile) =>
  resolveGuardian({
    guardianName: p.guardian_name,
    guardianRelationship: p.guardian_relationship,
    fatherName: p.father_name,
    motherName: p.mother_name,
  });
const guardianName = (p: ConsentProfile) => effectiveGuardian(p).name;

/** Covered by the always-required name / email / phone checks below. */
export const ALWAYS_REQUIRED_PLACEHOLDERS = ["student_name", "student_email", "student_phone"] as const;
/** Filled by the system, never from the student profile. */
export const AUTOMATIC_PLACEHOLDERS = ["organization", "date", "consent_version"] as const;

/** Placeholder -> the profile requirement behind it. */
type Section = (typeof SECTION_ORDER)[number];
export const PLACEHOLDER_REQUIREMENTS: Record<string, { label: string; section: Section; ok: (p: ConsentProfile) => boolean }> = {
  city: { label: "City", section: "Personal Information", ok: (p) => !!getLeadCity(p) },
  nationality: { label: "Nationality", section: "Personal Information", ok: (p) => !!getLeadNationality(p) },
  country: { label: "Residence Country", section: "Personal Information", ok: (p) => filled(p.country) },
  passport_number: { label: "Passport Number", section: "Passport & Citizenship", ok: (p) => filled(p.passport_number) },
  full_address: { label: "Full Address", section: "Basic Details", ok: (p) => filled(p.full_address) },
  street_address: { label: "Full Address", section: "Basic Details", ok: (p) => filled(p.full_address) },
  father_name: { label: "Father's Name", section: "Basic Details", ok: (p) => filled(p.father_name) },
  mother_name: { label: "Mother's Name", section: "Basic Details", ok: (p) => filled(p.mother_name) },
  parent_name: { label: "Guardian Name", section: "Guardian Details", ok: (p) => filled(guardianName(p)) },
  guardian_name: { label: "Guardian Name", section: "Guardian Details", ok: (p) => filled(guardianName(p)) },
  counselor_name: { label: "Assigned Counselor", section: "Assignment", ok: (p) => filled(p.assigned_to) },
  assign_name: { label: "Assigned Counselor", section: "Assignment", ok: (p) => filled(p.assigned_to) },
  emergency_contact_name: { label: "Emergency Contact Name", section: "Basic Details", ok: (p) => filled(p.emergency_contact_name) },
  emergency_contact_phone: { label: "Emergency Contact No.", section: "Basic Details", ok: (p) => filled(p.emergency_contact_phone) },
  date_of_birth: { label: "Date of Birth", section: "Basic Details", ok: (p) => filled(p.date_of_birth) },
  guardian_phone: { label: "Guardian Phone", section: "Guardian Details", ok: (p) => noGuardian(p) || filled(p.guardian_phone) },
  guardian_email: { label: "Guardian Email", section: "Guardian Details", ok: (p) => noGuardian(p) || filled(p.guardian_email) },
  guardian_relationship: { label: "Guardian Relationship", section: "Guardian Details", ok: (p) => filled(effectiveGuardian(p).relationship) },
};

/** The distinct `{{placeholders}}` used in a template body. */
export function extractTemplatePlaceholders(body: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const match of (body ?? "").matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

/**
 * What every student needs before THIS template can go out, grouped like the Student Details pop-up —
 * the same rule computeConsentReadiness applies, minus a specific student. Shown in Settings so the
 * admin (and through them, staff) knows what to fill in up front.
 */
export function consentRequirementGroups(templateBody: string | null | undefined): MissingGroup[] {
  const found: { label: string; section: Section }[] = [];
  const add = (label: string, section: Section) => {
    if (!found.some((f) => f.label === label)) found.push({ label, section });
  };
  add("First Name", "Personal Information");
  add("Email", "Personal Information");
  add("Phone", "Personal Information");
  add("Field of Study", "Study Interest");
  add("Degree Level", "Study Interest");
  for (const placeholder of extractTemplatePlaceholders(templateBody)) {
    const requirement = PLACEHOLDER_REQUIREMENTS[placeholder];
    if (requirement) add(requirement.label, requirement.section);
  }
  return SECTION_ORDER.map((section) => ({
    section,
    fields: found.filter((f) => f.section === section).map((f) => f.label),
  })).filter((g) => g.fields.length > 0);
}

export function computeConsentReadiness(templateBody: string | null | undefined, profile: ConsentProfile): ConsentReadiness {
  const found: { label: string; section: Section }[] = [];
  const add = (label: string, section: Section) => {
    if (!found.some((f) => f.label === label)) found.push({ label, section });
  };

  // Always required. Named exactly as in Student Details (the study check says WHICH of the two is empty).
  if (!filled(profile.first_name)) add("First Name", "Personal Information");
  if (!filled(profile.email)) add("Email", "Personal Information");
  if (!filled(profile.phone)) add("Phone", "Personal Information");
  if (!filled(profile.field_of_study)) add("Field of Study", "Study Interest");
  if (!filled(profile.degree_level)) add("Degree Level", "Study Interest");

  for (const placeholder of extractTemplatePlaceholders(templateBody)) {
    const requirement = PLACEHOLDER_REQUIREMENTS[placeholder];
    if (requirement && !requirement.ok(profile)) add(requirement.label, requirement.section);
  }

  const groups: MissingGroup[] = SECTION_ORDER.map((section) => ({
    section,
    fields: found.filter((f) => f.section === section).map((f) => f.label),
  })).filter((g) => g.fields.length > 0);

  return { ready: found.length === 0, missing: found.map((f) => f.label), groups };
}

/**
 * Loads the tenant's active consent template + the lead's profile and checks them.
 * Returns null when there is no active template or the lead is gone — callers then fall through to
 * their existing NO_TEMPLATE / not-found handling instead of inventing a second one.
 *
 * Pass `preloaded` with whatever the caller already fetched (the template body, the lead row selected
 * with CONSENT_PROFILE_COLUMNS) so it isn't read twice.
 */
export async function loadConsentReadiness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  preloaded: { template?: { body: string | null; is_active: boolean } | null; profile?: ConsentProfile | null } = {},
): Promise<ConsentReadiness | null> {
  let template = preloaded.template;
  if (template === undefined) {
    const { data: tpl, error: tplErr } = await supabase
      .from("consent_templates")
      .select("body, is_active")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (tplErr) logger.error({ err: tplErr, tenantId }, "consent readiness: could not load the consent template");
    template = tpl as { body: string | null; is_active: boolean } | null;
  }
  if (!template?.is_active) return null;

  let profile = preloaded.profile;
  if (profile === undefined) {
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select(CONSENT_PROFILE_COLUMNS)
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    // A failed query must be loud: it silently turns the profile gate OFF (e.g. a missing column on an
    // out-of-date database), which is exactly the bug this log exists to catch.
    if (leadErr) logger.error({ err: leadErr, tenantId, leadId }, "consent readiness: could not load the lead profile — gate not applied");
    profile = lead as unknown as ConsentProfile | null;
  }
  if (!profile) return null;

  return computeConsentReadiness(template.body, profile);
}

/** A string that changes whenever any profile field the consent check reads changes (for UI refresh). */
export function consentProfileKey(lead: Partial<ConsentProfile>): string {
  return [
    lead.first_name, lead.email, lead.phone, lead.field_of_study, lead.degree_level, lead.city, lead.nationality, lead.country,
    lead.passport_number, lead.full_address, lead.father_name, lead.mother_name, lead.emergency_contact_name,
    lead.emergency_contact_phone, lead.date_of_birth, lead.guardian_phone, lead.guardian_email, lead.guardian_relationship, lead.guardian_name, lead.assigned_to,
    JSON.stringify(lead.custom_fields ?? {}),
  ].join("|");
}
