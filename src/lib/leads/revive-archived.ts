import type { createServiceClient } from "@/lib/supabase/server";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { holderChange, listIdsChange } from "@/lib/leads/stage-move-audit";
import { onLeadsEnteredStageSafe } from "@/industries/_shared/features/outreach/lib/stage-auto-enroll";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// An ARCHIVED lead that fills a public form again is a re-interested lead. The dedup path attaches the new
// submission to the old lead and (by design) never touches stage/status/owner, which left the lead sitting in Archive
// where nobody looks. This moves it back to where a brand-new form lead would land ("New"), so staff see it.
// Client request (Manish, Nov 2026): "archive lead, getting re-register used to come to New … we might miss
// re-interested leads".

export interface ReviveList {
  id: string;
  name: string;
  slug: string;
  is_archive: boolean;
  is_intake: boolean;
}

export interface ReviveTarget {
  listId: string;
  listName: string;
  leadType: "lead" | "prospect";
}

// Pure — no DB. Returns null when the lead is not in an archive list (nothing to do) or there is nowhere to put it.
// Target = the list the form routes new leads to (when it is a real, non-archive list), else the intake ("New") list.
export function pickReviveTarget(input: {
  currentListId: string | null;
  formTargetListId: string | null;
  lists: readonly ReviveList[];
}): ReviveTarget | null {
  const current = input.lists.find((l) => l.id === input.currentListId);
  if (!current?.is_archive) return null;

  const routed = input.formTargetListId
    ? input.lists.find((l) => l.id === input.formTargetListId && !l.is_archive)
    : undefined;
  const target = routed ?? input.lists.find((l) => l.is_intake && !l.is_archive);
  if (!target) return null;

  return {
    listId: target.id,
    listName: target.name,
    leadType: target.slug === "prospects" ? "prospect" : "lead",
  };
}

export interface ReviveResult {
  revived: boolean;
  fromListName?: string;
  toListName?: string;
}

export async function reviveArchivedLead(
  supabase: SupabaseServiceClient,
  params: {
    tenantId: string;
    lead: { id: string; list_id: string | null; assigned_to: string | null };
    formTargetListId: string | null;
    // Pipeline/stage/status a brand-new form lead would get — the lead lands exactly where a new one does.
    landing: { pipelineId: string | null; stageId: string | null; statusSlug: string | null };
    requestId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<ReviveResult> {
  const { tenantId, lead } = params;
  if (!lead.list_id) return { revived: false };

  const { data: listRows } = await supabase
    .from("lead_lists")
    .select("id, name, slug, is_archive, is_intake")
    .eq("tenant_id", tenantId);
  const lists = (listRows ?? []) as unknown as ReviveList[];

  const target = pickReviveTarget({
    currentListId: lead.list_id,
    formTargetListId: params.formTargetListId,
    lists,
  });
  if (!target) return { revived: false };
  const fromListName = lists.find((l) => l.id === lead.list_id)?.name ?? "Archive";

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    list_id: target.listId,
    lead_type: target.leadType,
    stage_changed_at: now,
    last_activity_at: now,
    updated_at: now,
    // Archive marks cleared (archive_reason stays as history, same as a restore).
    archived_by: null,
    archived_at: null,
    archived_from_list_id: null,
    archived_from_status: null,
  };
  if (params.landing.stageId) {
    payload.pipeline_id = params.landing.pipelineId;
    payload.stage_id = params.landing.stageId;
    payload.status = params.landing.statusSlug;
  }

  // Only move it if it is STILL in the archive list we read — two resubmissions at once must not double-move it.
  const { data: updated, error } = await supabase
    .from("leads")
    .update(payload)
    .eq("id", lead.id)
    .eq("tenant_id", tenantId)
    .eq("list_id", lead.list_id)
    .select("id");
  if (error || !updated || updated.length === 0) return { revived: false };

  await onLeadsEnteredStageSafe({
    tenantId,
    leadIds: [lead.id],
    fromListId: lead.list_id,
    toListId: target.listId,
  });

  await Promise.all([
    createAuditLog({
      tenantId,
      userId: null,
      action: "lead.updated",
      entityType: "lead",
      entityId: lead.id,
      changes: {
        list: { old: fromListName, new: target.listName },
        // Exact ids next to the names: Pulse prefers list_ids (this branch's stage-move audit contract).
        list_ids: listIdsChange(lead.list_id, target.listId),
        holder: holderChange(lead.assigned_to),
        restored_from_archive: { old: false, new: true },
        re_registered: { old: false, new: true },
      },
      ipAddress: params.ipAddress ?? undefined,
      userAgent: params.userAgent ?? undefined,
      requestId: params.requestId,
    }),
    emitEvent({
      tenantId,
      type: "lead.list_changed",
      entityType: "lead",
      entityId: lead.id,
      payload: { old_list_id: lead.list_id, new_list_id: target.listId, re_registered: true },
      requestId: params.requestId,
    }),
  ]);

  return { revived: true, fromListName, toListName: target.listName };
}
