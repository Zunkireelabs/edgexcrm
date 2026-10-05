import type { SupabaseClient } from "@supabase/supabase-js";
import { getLeadCity, getLeadNationality } from "@/lib/leads/lead-location";

/**
 * Is a student's profile complete enough to generate a consent document?
 *
 * The consent text is written by an admin with `{{placeholders}}` (see merge.ts) and each is filled
 * from the student's profile — an empty one goes out as a blank line. So "complete" is driven by the
 * CURRENT template: name / email / phone / study info are always required, plus the profile field
 * behind every placeholder the template actually uses. Edit the template and the rule follows.
 *
 * `country` (Residence Country) is deliberately not required: it has no edit spot on the education
 * lead page and renders harmlessly blank.
 */

export interface ConsentReadiness {
  ready: boolean;
  /** Human labels of what to fill in, e.g. ["Passport Number", "Father's Name"]. */
  missing: string[];
}

export interface ConsentProfile {
  first_name: string | null;
  email: string | null;
  phone: string | null;
  field_of_study: string | null;
  degree_level: string | null;
  city: string | null;
  nationality: string | null;
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
}

/** Columns the check reads — keep in sync with ConsentProfile. */
export const CONSENT_PROFILE_COLUMNS =
  "first_name, email, phone, field_of_study, degree_level, city, nationality, custom_fields, passport_number, full_address, father_name, mother_name, emergency_contact_name, emergency_contact_phone, date_of_birth, guardian_phone, guardian_email, guardian_relationship";

const filled = (v: string | null | undefined) => !!v?.trim();

/** Placeholder -> the profile requirement behind it. Placeholders not listed need nothing (automatic or optional). */
const PLACEHOLDER_REQUIREMENTS: Record<string, { label: string; ok: (p: ConsentProfile) => boolean }> = {
  city: { label: "City", ok: (p) => !!getLeadCity(p) },
  nationality: { label: "Nationality", ok: (p) => !!getLeadNationality(p) },
  passport_number: { label: "Passport Number", ok: (p) => filled(p.passport_number) },
  full_address: { label: "Full Address", ok: (p) => filled(p.full_address) },
  street_address: { label: "Full Address", ok: (p) => filled(p.full_address) },
  father_name: { label: "Father's Name", ok: (p) => filled(p.father_name) },
  mother_name: { label: "Mother's Name", ok: (p) => filled(p.mother_name) },
  parent_name: { label: "Father's or Mother's Name", ok: (p) => filled(p.father_name) || filled(p.mother_name) },
  emergency_contact_name: { label: "Emergency Contact Name", ok: (p) => filled(p.emergency_contact_name) },
  emergency_contact_phone: { label: "Emergency Contact No.", ok: (p) => filled(p.emergency_contact_phone) },
  date_of_birth: { label: "Date of Birth", ok: (p) => filled(p.date_of_birth) },
  guardian_phone: { label: "Guardian Phone", ok: (p) => filled(p.guardian_phone) },
  guardian_email: { label: "Guardian Email", ok: (p) => filled(p.guardian_email) },
  guardian_relationship: { label: "Guardian Relationship", ok: (p) => filled(p.guardian_relationship) },
};

/** The distinct `{{placeholders}}` used in a template body. */
export function extractTemplatePlaceholders(body: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const match of (body ?? "").matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

export function computeConsentReadiness(templateBody: string | null | undefined, profile: ConsentProfile): ConsentReadiness {
  const missing: string[] = [];
  const add = (label: string) => {
    if (!missing.includes(label)) missing.push(label);
  };

  if (!filled(profile.first_name)) add("Name");
  if (!filled(profile.email)) add("Email");
  if (!filled(profile.phone)) add("Phone");
  if (!filled(profile.field_of_study) || !filled(profile.degree_level)) add("Study Information");

  for (const placeholder of extractTemplatePlaceholders(templateBody)) {
    const requirement = PLACEHOLDER_REQUIREMENTS[placeholder];
    if (requirement && !requirement.ok(profile)) add(requirement.label);
  }

  return { ready: missing.length === 0, missing };
}

/**
 * Loads the tenant's active consent template + the lead's profile and checks them.
 * Returns null when there is no active template or the lead is gone — callers then fall through to
 * their existing NO_TEMPLATE / not-found handling instead of inventing a second one.
 */
export async function loadConsentReadiness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
): Promise<ConsentReadiness | null> {
  const { data: tpl } = await supabase
    .from("consent_templates")
    .select("body, is_active")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const template = tpl as { body: string | null; is_active: boolean } | null;
  if (!template?.is_active) return null;

  const { data: lead } = await supabase
    .from("leads")
    .select(CONSENT_PROFILE_COLUMNS)
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return null;

  return computeConsentReadiness(template.body, lead as unknown as ConsentProfile);
}

/** A string that changes whenever any profile field the consent check reads changes (for UI refresh). */
export function consentProfileKey(lead: Partial<ConsentProfile>): string {
  return [
    lead.first_name, lead.email, lead.phone, lead.field_of_study, lead.degree_level, lead.city, lead.nationality,
    lead.passport_number, lead.full_address, lead.father_name, lead.mother_name, lead.emergency_contact_name,
    lead.emergency_contact_phone, lead.date_of_birth, lead.guardian_phone, lead.guardian_email, lead.guardian_relationship,
    JSON.stringify(lead.custom_fields ?? {}),
  ].join("|");
}
