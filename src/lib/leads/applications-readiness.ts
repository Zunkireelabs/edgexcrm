import type { SupabaseClient } from "@supabase/supabase-js";
import { checkLeadProfileCompleteness } from "@/lib/leads/profile-completeness";

/**
 * Single source of truth for "is this lead ready for Applications?" (client request,
 * Admizz 2026-11-01). A lead may move into the Applications stage — and an application
 * may be created — only when ALL of these hold:
 *
 *  1. Processing fee entered. A counsellor's report ("claimed") is enough; the work
 *     does NOT wait for an owner/admin to verify it. (The admin still gets the
 *     notification and can confirm/reject — that flow is unchanged.) A fee the admin
 *     rejected ("unpaid") or one never entered fails this check.
 *  2. Basic info complete (name / email / phone / study info + a document).
 *  3. Consent signed — only when the tenant has an ACTIVE consent template.
 *
 * Nobody bypasses this (owner/admin included). Keep every caller on this helper so
 * the rule can't drift between the stage-move paths and the application-create paths.
 */

/** Fee statuses that satisfy the gate. "claimed" = reported by a counsellor, unverified. */
export const FEE_SATISFIED_STATUSES = ["claimed", "paid", "waiver"] as const;

export function isFeeEntered(status: string | null | undefined): boolean {
  return !!status && (FEE_SATISFIED_STATUSES as readonly string[]).includes(status);
}

/** True when the lead's processing fee is entered (claimed / paid / waiver). */
export async function checkProcessingFeeEntered(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  /** In-flight request values; a fee status sent in the same request wins over the stored one. */
  pending?: Record<string, unknown>,
): Promise<boolean> {
  if (pending && pending.pre_app_fee_status !== undefined) {
    return isFeeEntered(pending.pre_app_fee_status as string | null);
  }
  const { data } = await supabase
    .from("leads")
    .select("pre_app_fee_status")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return isFeeEntered((data as { pre_app_fee_status: string | null } | null)?.pre_app_fee_status);
}

export interface ApplicationsReadiness {
  ready: boolean;
  /** Human-readable labels of what is still missing, e.g. "Processing fee", "Consent signed". */
  missing: string[];
}

export function applicationsGateMessage(missing: string[]): string {
  return `Before moving to Applications, complete: ${missing.join(", ")}.`;
}

export async function checkApplicationsReadiness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  /**
   * Values from the request that is moving the lead (the PATCH body). Fee and basic-info
   * fields sent in the same request count — otherwise "set the fee and move to Applications"
   * in one call would be judged against the stale stored values.
   */
  pending?: Record<string, unknown>,
): Promise<ApplicationsReadiness> {
  const missing: string[] = [];

  // 1. Processing fee
  if (!(await checkProcessingFeeEntered(supabase, tenantId, leadId, pending))) missing.push("Processing fee");

  // 2. Basic info
  const profile = await checkLeadProfileCompleteness(supabase, tenantId, leadId, pending);
  if (!profile.complete) missing.push(`Basic info (${profile.missing.join(", ")})`);

  // 3. Consent — only if the tenant has an active consent template
  const { data: tpl } = await supabase
    .from("consent_templates")
    .select("is_active")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if ((tpl as { is_active: boolean } | null)?.is_active) {
    const { data: signed } = await supabase
      .from("lead_consents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .eq("status", "signed")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (!signed) missing.push("Consent signed");
  }

  return { ready: missing.length === 0, missing };
}
