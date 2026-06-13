import { createServiceClient } from "@/lib/supabase/server";
import type { DealPipelineWithCounts, DealStage, Deal } from "@/types/database";

export async function getDealPipelines(tenantId: string): Promise<DealPipelineWithCounts[]> {
  const supabase = await createServiceClient();

  const { data: pipelines, error } = await supabase
    .from("deal_pipelines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) throw error;

  const { data: stageCounts } = await supabase
    .from("deal_stages")
    .select("pipeline_id")
    .eq("tenant_id", tenantId);

  const { data: dealCounts } = await supabase
    .from("deals")
    .select("pipeline_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);

  const stageCountMap = new Map<string, number>();
  const dealCountMap = new Map<string, number>();

  for (const s of stageCounts || []) {
    if (s.pipeline_id) {
      stageCountMap.set(s.pipeline_id, (stageCountMap.get(s.pipeline_id) || 0) + 1);
    }
  }
  for (const d of dealCounts || []) {
    if (d.pipeline_id) {
      dealCountMap.set(d.pipeline_id, (dealCountMap.get(d.pipeline_id) || 0) + 1);
    }
  }

  return (pipelines || []).map((p) => ({
    ...p,
    stage_count: stageCountMap.get(p.id) || 0,
    deal_count: dealCountMap.get(p.id) || 0,
  })) as DealPipelineWithCounts[];
}

export async function getDealPipelineStages(
  tenantId: string,
  pipelineId: string
): Promise<DealStage[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("deal_stages")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });

  if (error) throw error;
  return (data as DealStage[]) || [];
}

export async function getDealsForPipeline(
  tenantId: string,
  options: { pipelineId: string }
): Promise<Deal[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("deals")
    .select(
      "*, accounts!deals_account_id_fkey(id,name), contacts!deals_primary_contact_id_fkey(id,first_name,last_name)"
    )
    .eq("tenant_id", tenantId)
    .eq("pipeline_id", options.pipelineId)
    .is("deleted_at", null)
    .order("last_activity_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data as Deal[]) || [];
}
