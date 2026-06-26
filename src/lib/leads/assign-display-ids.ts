import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assigns sequential ADM-NNN display IDs to education leads moved out of staging.
 * No-ops for non-education tenants, staging destinations, leads that already have IDs,
 * and null destination lists.
 */
export async function assignDisplayIdsOnMove(opts: {
  supabase: SupabaseClient;
  tenantId: string;
  industryId: string | null;
  destinationListId: string | null;
  leadIds: string[];
}): Promise<void> {
  const { supabase, tenantId, industryId, destinationListId, leadIds } = opts;

  if (industryId !== "education_consultancy") return;
  if (!destinationListId || leadIds.length === 0) return;

  const { data: destList } = await supabase
    .from("lead_lists")
    .select("is_staging")
    .eq("id", destinationListId)
    .maybeSingle();

  if (!destList || destList.is_staging) return;

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
    console.error("[assignDisplayIdsOnMove] RPC failed", { tenantId, error });
  }
}
