import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONSENT_PROFILE_COLUMNS,
  computeConsentReadiness,
  type ConsentProfile,
} from "@/lib/consent/readiness";

/**
 * "Basic info" for the Applications gate and application creation.
 *
 * Client request (Admizz, 2026-11-05): basic info is ONLY what the consent form needs, and documents are
 * NOT required (they can be uploaded later, even after the lead is in Applications). So this is exactly the
 * consent readiness rule — name / email / phone / study info plus the profile field behind every
 * `{{placeholder}}` in the tenant's active consent template. Edit the template and the rule follows.
 * With no active template, only the always-required name / email / phone / study info apply.
 *
 * Not required just to save a lead — counselors must be able to capture a bare-minimum lead and fill the
 * details in later.
 */
export interface ProfileCompletenessGaps {
  complete: boolean;
  /** Field labels as shown in Student Details, e.g. "First Name", "Passport Number", "Guardian Name". */
  missing: string[];
}

const PROFILE_KEYS = CONSENT_PROFILE_COLUMNS.split(",").map((c) => c.trim());

/** Only the profile fields that are actually present in the pending request. */
function pickPending(pending: Record<string, unknown>): Partial<ConsentProfile> {
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    if (pending[key] === undefined) continue;
    out[key] = key === "custom_fields" ? pending[key] : pending[key] == null ? null : String(pending[key]);
  }
  return out as Partial<ConsentProfile>;
}

const EMPTY_PROFILE: ConsentProfile = {
  first_name: null, email: null, phone: null, field_of_study: null, degree_level: null, city: null,
  nationality: null, country: null, custom_fields: null, passport_number: null, full_address: null,
  father_name: null, mother_name: null, emergency_contact_name: null, emergency_contact_phone: null,
  date_of_birth: null, guardian_phone: null, guardian_email: null, guardian_relationship: null,
  guardian_name: null, assigned_to: null,
};

export async function checkLeadProfileCompleteness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  /**
   * Values arriving in the SAME request (e.g. a PATCH that sets the phone and moves the stage together).
   * A key present here overrides the stored value, so the check judges what the lead WILL look like,
   * not the pre-update row.
   */
  pending?: Record<string, unknown>,
): Promise<ProfileCompletenessGaps> {
  const { data: tpl } = await supabase
    .from("consent_templates")
    .select("body, is_active")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const template = tpl as { body: string | null; is_active: boolean } | null;

  const { data: leadData } = await supabase
    .from("leads")
    .select(CONSENT_PROFILE_COLUMNS)
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const stored = (leadData as unknown as ConsentProfile | null) ?? EMPTY_PROFILE;
  const profile: ConsentProfile = pending ? { ...stored, ...pickPending(pending) } : stored;

  // No active template -> no placeholders to check; only the always-required fields remain.
  const result = computeConsentReadiness(template?.is_active ? template.body : null, profile);
  return { complete: result.ready, missing: result.missing };
}
