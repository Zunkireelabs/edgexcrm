import type { SupabaseClient } from "@supabase/supabase-js";

// Every Stage (lead_lists row) needs a hidden list-bound pipeline (pipelines.list_id = list.id) whose pipeline_stages
// are the stage's statuses. The original stages got theirs from migrations (088, 111, 154). A Stage created later from
// Settings → Add/Edit stages got none, so moving a lead into it tried to write leads.pipeline_id = NULL and failed
// ("Failed to update lead"). Client report (Manish, Nov 2026): the new "Enrolled" stage showed up but no lead could be
// moved into it.
//
// ensureListPipeline() creates the missing pipeline + a default status set. Idempotent and race-safe: it returns the
// existing pipeline_id when there is one, and if two callers race, the loser discards its own and uses the winner's.

// Same generic set migration 088 gave every non-funnel list. Admins rename / add statuses from the pipeline editor.
export const DEFAULT_LIST_STATUSES = [
  { name: "New", slug: "new", color: "#3b82f6", is_default: true },
  { name: "Contacted", slug: "contacted", color: "#a855f7", is_default: false },
  { name: "Follow-up", slug: "follow-up", color: "#f59e0b", is_default: false },
  { name: "Done", slug: "done", color: "#22c55e", is_default: false },
] as const;

export interface EnsurePipelineList {
  id: string;
  slug: string;
  name: string;
  pipeline_id: string | null;
}

export async function ensureListPipeline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  list: EnsurePipelineList
): Promise<string | null> {
  if (list.pipeline_id) return list.pipeline_id;

  // Re-read: another request may have created it since the caller loaded the list.
  const readCurrent = async (): Promise<string | null> => {
    const { data } = await supabase
      .from("lead_lists")
      .select("pipeline_id")
      .eq("id", list.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return (data as { pipeline_id: string | null } | null)?.pipeline_id ?? null;
  };
  const already = await readCurrent();
  if (already) return already;

  const { data: last } = await supabase
    .from("pipelines")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  // Short id suffix keeps the slug unique even if an admin makes two stages with similar names.
  const pipelineSlug = `${list.slug}-pipeline-${list.id.slice(0, 8)}`;
  const { data: created, error: pipeErr } = await supabase
    .from("pipelines")
    .insert({
      tenant_id: tenantId,
      name: list.name,
      slug: pipelineSlug,
      position,
      is_default: false,
      is_active: true,
      list_id: list.id,
    })
    .select("id")
    .single();
  if (pipeErr || !created) return null;
  const pipelineId = (created as { id: string }).id;

  const discard = async () => {
    await supabase.from("pipelines").delete().eq("id", pipelineId).eq("tenant_id", tenantId);
  };

  const { error: stagesErr } = await supabase.from("pipeline_stages").insert(
    DEFAULT_LIST_STATUSES.map((s, i) => ({
      tenant_id: tenantId,
      pipeline_id: pipelineId,
      name: s.name,
      slug: s.slug,
      position: i,
      color: s.color,
      is_default: s.is_default,
      is_terminal: false,
      terminal_type: null,
    }))
  );
  if (stagesErr) {
    await discard();
    return null;
  }

  // Link it — only if nobody linked one first. 0 rows updated = we lost the race: drop ours, use theirs.
  const { data: linked, error: linkErr } = await supabase
    .from("lead_lists")
    .update({ pipeline_id: pipelineId })
    .eq("id", list.id)
    .eq("tenant_id", tenantId)
    .is("pipeline_id", null)
    .select("id");
  if (linkErr) {
    await discard();
    return null;
  }
  if (!linked || linked.length === 0) {
    await discard();
    return readCurrent();
  }

  return pipelineId;
}
