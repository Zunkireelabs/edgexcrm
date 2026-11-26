// When a lead's email is EDITED (not created), check whether another lead already has it and, if so, leave a duplicate
// suggestion for the admins. Never blocks the save and never merges: the same email can be legitimate (a parent's address
// on two siblings' leads), so an admin decides. Creation paths already do this check (see dedup.ts resolveLeadIdentity).

import type { createServiceClient } from "@/lib/supabase/server";
import { normalizeEmail, recordDuplicateSuggestions } from "./dedup";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/** Other live, finished leads in this company with the same email (case and spaces ignored). Oldest first. */
export async function findEmailDuplicateIds(
  supabase: SupabaseServiceClient,
  params: { tenantId: string; leadId: string; email: string | null | undefined },
): Promise<string[]> {
  const normalized = normalizeEmail(params.email);
  if (!normalized) return [];
  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("normalized_email", normalized)
    .is("deleted_at", null)
    .eq("is_final", true)
    .neq("id", params.leadId)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error || !data) return [];
  return (data as { id: string }[]).map((r) => r.id);
}

/** Leads this lead already has a suggestion with, in either direction and whatever its status (a dismissed one stays dismissed). */
async function alreadySuggestedWith(supabase: SupabaseServiceClient, tenantId: string, leadId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("lead_duplicate_suggestions")
    .select("lead_id, suggested_lead_id")
    .eq("tenant_id", tenantId)
    .or(`lead_id.eq.${leadId},suggested_lead_id.eq.${leadId}`);
  // If this cannot be read, do nothing rather than risk a second row for the same pair.
  if (error || !data) throw new Error("could not read existing duplicate suggestions");
  const out = new Set<string>();
  for (const r of data as { lead_id: string; suggested_lead_id: string }[]) {
    out.add(r.lead_id === leadId ? r.suggested_lead_id : r.lead_id);
  }
  return out;
}

/**
 * Best-effort: records an 'email' duplicate suggestion for each match that has no suggestion yet. Returns how many it recorded.
 * One row per pair: a pair already suggested (for its phone, say) in either direction, or dismissed, is left alone, so the admins'
 * card never lists the same lead twice. Swallows every error, so a failed lookup can never turn a successful lead edit into a failure.
 */
export async function suggestEmailDuplicates(
  supabase: SupabaseServiceClient,
  params: { tenantId: string; leadId: string; email: string | null | undefined },
  onError?: (err: unknown) => void,
): Promise<number> {
  try {
    const found = await findEmailDuplicateIds(supabase, params);
    if (found.length === 0) return 0;
    const taken = await alreadySuggestedWith(supabase, params.tenantId, params.leadId);
    const ids = found.filter((id) => !taken.has(id));
    if (ids.length === 0) return 0;
    await recordDuplicateSuggestions(supabase, {
      tenantId: params.tenantId,
      leadId: params.leadId,
      suggestedLeadIds: ids,
      reason: "email",
    });
    return ids.length;
  } catch (err) {
    onError?.(err);
    return 0;
  }
}
