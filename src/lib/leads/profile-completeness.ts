import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fields required before an Application can be created for a lead (client
 * request, 2026-09-23: name/email/phone/study info + a document must be
 * filled in before a lead can formally apply — not required to just save
 * the lead, since counselors need to be able to quickly capture a bare-
 * minimum lead and fill details in later).
 */
export interface ProfileCompletenessGaps {
  complete: boolean;
  missing: string[];
}

interface LeadProfileRow {
  first_name: string | null;
  email: string | null;
  phone: string | null;
  field_of_study: string | null;
  degree_level: string | null;
}

/**
 * Checks whether a lead's core profile (name/email/phone/study info) and at
 * least one uploaded document are present. Called right before an
 * Application row is inserted — see the two POST /applications routes.
 */
export async function checkLeadProfileCompleteness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
): Promise<ProfileCompletenessGaps> {
  const missing: string[] = [];

  const { data: leadData } = await supabase
    .from("leads")
    .select("first_name, email, phone, field_of_study, degree_level")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const lead = leadData as LeadProfileRow | null;

  if (!lead?.first_name?.trim()) missing.push("Name");
  if (!lead?.email?.trim()) missing.push("Email");
  if (!lead?.phone?.trim()) missing.push("Phone");
  if (!lead?.field_of_study?.trim() || !lead?.degree_level?.trim()) missing.push("Study Information");

  const { count } = await supabase
    .from("applicant_documents")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .is("deleted_at", null);
  if (!count || count === 0) missing.push("a document");

  return { complete: missing.length === 0, missing };
}
