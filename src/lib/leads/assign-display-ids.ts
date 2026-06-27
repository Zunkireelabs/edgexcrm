import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assigns sequential ADM-NNN display IDs to education leads.
 *
 * Assignment policy:
 *   - destinationListId = null  → lead is live (pipeline / no list) → assign.
 *   - destinationListId = UUID  → look up is_staging; skip if true, assign if false.
 *
 * No-ops for non-education tenants, empty leadIds, and staging destinations.
 * Best-effort: logs on RPC error but never throws.
 */
export async function assignDisplayIds(opts: {
  supabase: SupabaseClient;
  tenantId: string;
  industryId: string | null;
  destinationListId: string | null;
  leadIds: string[];
}): Promise<void> {
  const { supabase, tenantId, industryId, destinationListId, leadIds } = opts;

  if (industryId !== "education_consultancy") return;
  if (leadIds.length === 0) return;

  if (destinationListId !== null) {
    const { data: destList } = await supabase
      .from("lead_lists")
      .select("is_staging")
      .eq("id", destinationListId)
      .maybeSingle();

    if (!destList || destList.is_staging) return;
  }
  // null destinationListId → live / pipeline → proceed to assign

  const { data: tenant } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  const prefix = ((tenant?.slug ?? "lead") as string).slice(0, 3).toUpperCase();

  const { error } = await supabase.rpc("assign_education_display_ids", {
    p_tenant: tenantId,
    p_prefix: prefix,
    p_lead_ids: leadIds,
  });

  if (error) {
    console.error("[assignDisplayIds] RPC failed", { tenantId, error });
  }
}
