/**
 * Lead merge primitive — used by the manual-merge API, the undo API, and the backfill script.
 *
 * Hard rules:
 *   • No data loss: absorbed lead's field values are preserved in a synthesized
 *     lead_submissions row before the lead is soft-deleted.
 *   • Full reversibility: every re-pointed FK row ID is stored in lead_merges.repointed_ids,
 *     field changes stored as {old, new} in lead_merges.field_patch, so undo() reverses precisely.
 *   • Never merges converted leads (converted_at IS NOT NULL).
 *
 * TODO(atomicity): consider plpgsql RPC — see B1 fixup brief #4.
 * Currently: lead_merges row is inserted first (empty) so a partial failure always leaves an
 * inspectable record; finalized via UPDATE after all FK re-pointing + field merge + soft-delete.
 * True atomicity requires a Postgres function — decision reserved for Opus/Sadin.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { applyCanonicalUpdate, recordSubmission } from "./dedup";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import {
  upsertThreadNotification,
  getTenantAdminRecipients,
  NotificationTypes,
} from "@/lib/notifications";
import type { Lead } from "@/types/database";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export interface MergeLeadsParams {
  tenantId: string;
  canonicalId: string;
  absorbedId: string;
  mergedBy: string | null;       // auth.userId — null for backfill
  source: "manual" | "backfill";
  requestId?: string;
}

export interface MergeResult {
  canonicalId: string;
  mergeId: string;
  repointedCounts: Record<string, number>;
}

// ── helpers ────────────────────────────────────────────────────────────────

async function loadLead(supabase: SupabaseServiceClient, id: string): Promise<Lead | null> {
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as Lead | null;
}

const rowIds = (data: unknown[] | null): string[] =>
  ((data ?? []) as { id: string }[]).map((r) => r.id);

// ── mergeLeads ─────────────────────────────────────────────────────────────

export async function mergeLeads(
  supabase: SupabaseServiceClient,
  params: MergeLeadsParams
): Promise<MergeResult> {
  const { tenantId, canonicalId, absorbedId, mergedBy, source, requestId } = params;

  // ── 1. Load + validate both leads ──────────────────────────────────────
  const [canonical, absorbed] = await Promise.all([
    loadLead(supabase, canonicalId),
    loadLead(supabase, absorbedId),
  ]);

  if (!canonical) throw new Error(`mergeLeads: canonical lead ${canonicalId} not found`);
  if (!absorbed) throw new Error(`mergeLeads: absorbed lead ${absorbedId} not found`);

  if (canonical.tenant_id !== tenantId || absorbed.tenant_id !== tenantId) {
    throw new Error("mergeLeads: both leads must belong to the same tenant");
  }
  if (canonicalId === absorbedId) {
    throw new Error("mergeLeads: canonicalId and absorbedId must be different");
  }
  if (canonical.deleted_at !== null) {
    throw new Error("mergeLeads: canonical lead is already deleted");
  }
  if (absorbed.deleted_at !== null) {
    throw new Error("mergeLeads: absorbed lead is already deleted");
  }
  if (canonical.converted_at !== null) {
    throw new Error("mergeLeads: cannot merge a converted lead (canonical)");
  }
  if (absorbed.converted_at !== null) {
    throw new Error("mergeLeads: cannot merge a converted lead (absorbed)");
  }

  // ── 2. Insert lead_merges row first (empty) — pragmatic atomicity fallback ──
  // A partial failure during re-pointing always leaves a durable, inspectable record.
  // TODO(atomicity): consider plpgsql RPC — see B1 fixup brief #4.
  const { data: mergeRowInit, error: mergeInitErr } = await supabase
    .from("lead_merges")
    .insert({
      tenant_id: tenantId,
      canonical_id: canonicalId,
      absorbed_id: absorbedId,
      merged_by: mergedBy ?? null,
      source,
      repointed_counts: {},
      repointed_ids: {},
      field_patch: {},
    })
    .select("id")
    .single();

  if (mergeInitErr || !mergeRowInit) {
    throw new Error(`mergeLeads: failed to create lead_merges row: ${mergeInitErr?.message ?? "no data"}`);
  }

  const mergeId = (mergeRowInit as { id: string }).id;

  // ── 3. Synthesize a lead_submissions row for the absorbed lead ─────────
  // No-data-loss guarantee: absorbed's exact field values captured verbatim.
  const synthesizedSubmissionId = await recordSubmission(supabase, {
    tenantId,
    leadId: canonicalId,
    formConfigId: absorbed.form_config_id ?? null,
    sessionId: absorbed.session_id ?? null,
    createdVia: source === "backfill" ? "backfill" : "manual",
    firstName: absorbed.first_name,
    lastName: absorbed.last_name,
    email: absorbed.email,
    phone: absorbed.phone,
    city: absorbed.city,
    country: absorbed.country,
    normalizedEmail: absorbed.normalized_email ?? null,
    customFields: absorbed.custom_fields as Record<string, unknown>,
    fileUrls: absorbed.file_urls as Record<string, unknown>,
    intakeSource: absorbed.intake_source,
    intakeMedium: absorbed.intake_medium,
    intakeCampaign: absorbed.intake_campaign,
    entityId: absorbed.entity_id,
    rawPayload: absorbed as unknown as Record<string, unknown>,
    matchedExisting: true,
  });

  // ── 4. Re-point every lead_id FK absorbed → canonical ─────────────────
  // Store row IDs per table so undo can reverse precisely (without over-moving
  // the canonical lead's own original children).
  const repointedIds: Record<string, string[]> = {};
  const repointedCounts: Record<string, number> = {};

  const track = (table: string, moved: string[]) => {
    repointedIds[table] = moved;
    repointedCounts[table] = moved.length;
  };

  // lead_submissions: skip the just-synthesized row (already on canonical)
  {
    const { data } = await supabase
      .from("lead_submissions")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .neq("id", synthesizedSubmissionId)
      .select("id");
    track("lead_submissions", rowIds(data));
  }
  {
    const { data } = await supabase
      .from("lead_notes")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    track("lead_notes", rowIds(data));
  }
  {
    const { data } = await supabase
      .from("lead_checklists")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    track("lead_checklists", rowIds(data));
  }
  {
    const { data } = await supabase
      .from("lead_activities")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    track("lead_activities", rowIds(data));
  }
  {
    const { data } = await supabase
      .from("tasks")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    track("tasks", rowIds(data));
  }
  {
    const { data } = await supabase
      .from("email_threads")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    track("email_threads", rowIds(data));
  }

  // audit_logs + events use entity_id, not lead_id
  {
    const { data } = await supabase
      .from("audit_logs")
      .update({ entity_id: canonicalId })
      .eq("entity_type", "lead")
      .eq("entity_id", absorbedId)
      .select("id");
    track("audit_logs", rowIds(data));
  }
  {
    const { data } = await supabase
      .from("events")
      .update({ entity_id: canonicalId })
      .eq("entity_type", "lead")
      .eq("entity_id", absorbedId)
      .select("id");
    track("events", rowIds(data));
  }

  // lead_insights — UNIQUE(lead_id): delete absorbed's row if canonical already has one,
  // otherwise re-point. AI insights are regenerable so deletion is acceptable.
  {
    const [{ data: canonicalInsight }, { data: absorbedInsight }] = await Promise.all([
      supabase.from("lead_insights").select("id").eq("lead_id", canonicalId).maybeSingle(),
      supabase.from("lead_insights").select("id").eq("lead_id", absorbedId).maybeSingle(),
    ]);

    if (absorbedInsight) {
      const insightId = (absorbedInsight as { id: string }).id;
      if (canonicalInsight) {
        await supabase.from("lead_insights").delete().eq("id", insightId);
        repointedIds.lead_insights_deleted = [insightId];
        repointedCounts.lead_insights_deleted = 1;
      } else {
        await supabase.from("lead_insights").update({ lead_id: canonicalId }).eq("id", insightId);
        track("lead_insights", [insightId]);
      }
    }
  }

  // lead_duplicate_suggestions — delete rows referencing the absorbed lead in either column.
  // These are phone-match candidates (regenerable); not restored on undo.
  {
    const { data } = await supabase
      .from("lead_duplicate_suggestions")
      .delete()
      .or(`lead_id.eq.${absorbedId},suggested_lead_id.eq.${absorbedId}`)
      .select("id");
    repointedCounts.lead_duplicate_suggestions_deleted = rowIds(data).length;
  }

  // ── 5. Merge fields into canonical (fill-empty; JSONB merge; tags union) ─
  const fieldPatchFlat = applyCanonicalUpdate(canonical, {
    first_name: absorbed.first_name,
    last_name: absorbed.last_name,
    email: absorbed.email,
    phone: absorbed.phone,
    city: absorbed.city,
    country: absorbed.country,
    entity_id: absorbed.entity_id,
    custom_fields: absorbed.custom_fields as Record<string, unknown>,
    file_urls: absorbed.file_urls as Record<string, unknown>,
    tags: absorbed.tags,
  });

  // Store {old, new} per key so undo can restore old values rather than nulling them out.
  // Critical for JSONB/array fields where applyCanonicalUpdate produces a merged superset:
  // without old values, undo would null canonical's custom_fields/file_urls/tags.
  const fieldPatchDetailed: Record<string, { old: unknown; new: unknown }> = {};
  const canonicalMap = canonical as unknown as Record<string, unknown>;
  for (const key of Object.keys(fieldPatchFlat)) {
    fieldPatchDetailed[key] = {
      old: canonicalMap[key] ?? null,
      new: fieldPatchFlat[key],
    };
  }

  if (Object.keys(fieldPatchFlat).length > 0) {
    await supabase
      .from("leads")
      .update(fieldPatchFlat)
      .eq("id", canonicalId)
      .eq("tenant_id", tenantId);
  }

  // ── 6. Soft-delete absorbed lead ───────────────────────────────────────
  await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString(), merged_into: canonicalId })
    .eq("id", absorbedId)
    .eq("tenant_id", tenantId);

  // ── 7. Finalize lead_merges row with all collected data ────────────────
  await supabase
    .from("lead_merges")
    .update({
      repointed_counts: repointedCounts,
      repointed_ids: repointedIds,
      field_patch: fieldPatchDetailed,
      synthesized_submission_id: synthesizedSubmissionId,
    })
    .eq("id", mergeId);

  // ── 8. Audit + event + notification ────────────────────────────────────
  await Promise.all([
    createAuditLog({
      tenantId,
      userId: mergedBy ?? undefined,
      action: "lead.merged",
      entityType: "lead",
      entityId: canonicalId,
      changes: {
        absorbed_id: { old: absorbedId, new: null },
        merge_id: { old: null, new: mergeId },
        source: { old: null, new: source },
      },
      requestId,
    }),
    emitEvent({
      tenantId,
      type: "lead.merged",
      entityType: "lead",
      entityId: canonicalId,
      payload: {
        absorbed_id: absorbedId,
        merge_id: mergeId,
        source,
        repointed_counts: repointedCounts,
      },
      requestId,
    }),
    (async () => {
      try {
        const refreshed = await loadLead(supabase, canonicalId);
        const canonicalWithPatch = refreshed ?? canonical;
        const leadName =
          `${canonicalWithPatch.first_name ?? ""} ${canonicalWithPatch.last_name ?? ""}`.trim() || "A lead";

        if (canonicalWithPatch.assigned_to) {
          await upsertThreadNotification({
            tenantId,
            userId: canonicalWithPatch.assigned_to,
            type: NotificationTypes.LEAD_CREATED,
            title: "Lead merged",
            message: `${leadName} — duplicate record absorbed`,
            link: `/leads/${canonicalId}`,
          });
        } else {
          const adminIds = await getTenantAdminRecipients(supabase, tenantId);
          await Promise.all(
            adminIds.map((adminId) =>
              upsertThreadNotification({
                tenantId,
                userId: adminId,
                type: NotificationTypes.LEAD_CREATED,
                title: "Lead merged",
                message: `${leadName} — duplicate record absorbed`,
                link: `/leads/${canonicalId}`,
              })
            )
          );
        }
      } catch {
        // non-fatal
      }
    })(),
  ]);

  return { canonicalId, mergeId, repointedCounts };
}

// ── undoMerge ──────────────────────────────────────────────────────────────

export interface UndoMergeResult {
  restoredAbsorbedId: string;
  canonicalId: string;
}

export async function undoMerge(
  supabase: SupabaseServiceClient,
  mergeId: string,
  tenantId: string,              // required — mismatch treated as not-found
  undoneBy?: string | null,
  requestId?: string
): Promise<UndoMergeResult> {
  const { data: merge } = await supabase
    .from("lead_merges")
    .select("*")
    .eq("id", mergeId)
    .maybeSingle();

  // Treat tenant mismatch as not-found to avoid leaking existence across tenants
  if (!merge || (merge as { tenant_id: string }).tenant_id !== tenantId) {
    throw new Error(`undoMerge: merge record ${mergeId} not found`);
  }

  const m = merge as {
    id: string;
    tenant_id: string;
    canonical_id: string;
    absorbed_id: string;
    field_patch: Record<string, { old: unknown; new: unknown }>;
    repointed_ids: Record<string, string[]>;
    synthesized_submission_id: string | null;
    undone_at: string | null;
  };

  if (m.undone_at !== null) {
    throw new Error(`undoMerge: merge ${mergeId} has already been undone`);
  }

  const { canonical_id: canonicalId, absorbed_id: absorbedId } = m;
  const rids = m.repointed_ids ?? {};

  // ── 1. Re-point FK children back to absorbed using stored IDs ──────────
  // Precise: only moves rows that were originally on the absorbed lead.
  if (rids.lead_submissions?.length) {
    await supabase.from("lead_submissions").update({ lead_id: absorbedId }).in("id", rids.lead_submissions);
  }
  if (rids.lead_notes?.length) {
    await supabase.from("lead_notes").update({ lead_id: absorbedId }).in("id", rids.lead_notes);
  }
  if (rids.lead_checklists?.length) {
    await supabase.from("lead_checklists").update({ lead_id: absorbedId }).in("id", rids.lead_checklists);
  }
  if (rids.lead_activities?.length) {
    await supabase.from("lead_activities").update({ lead_id: absorbedId }).in("id", rids.lead_activities);
  }
  if (rids.tasks?.length) {
    await supabase.from("tasks").update({ lead_id: absorbedId }).in("id", rids.tasks);
  }
  if (rids.email_threads?.length) {
    await supabase.from("email_threads").update({ lead_id: absorbedId }).in("id", rids.email_threads);
  }
  if (rids.audit_logs?.length) {
    await supabase.from("audit_logs").update({ entity_id: absorbedId }).in("id", rids.audit_logs);
  }
  if (rids.events?.length) {
    await supabase.from("events").update({ entity_id: absorbedId }).in("id", rids.events);
  }
  // lead_insights: re-pointed (not deleted) — move back to absorbed
  if (rids.lead_insights?.length) {
    await supabase.from("lead_insights").update({ lead_id: absorbedId }).in("id", rids.lead_insights);
  }
  // lead_insights_deleted: deleted during merge and cannot be restored (AI-regenerable)
  // lead_duplicate_suggestions_deleted: deleted during merge and not restored (regenerable)

  // ── 2. Delete the synthesized submission ───────────────────────────────
  if (m.synthesized_submission_id) {
    await supabase.from("lead_submissions").delete().eq("id", m.synthesized_submission_id);
  }

  // ── 3. Revert field_patch on canonical ─────────────────────────────────
  // field_patch is stored as {old, new} per key. Restore old value only if
  // the current value still matches what we set during merge — avoids
  // overwriting post-merge manual edits on the canonical lead.
  const { data: currentCanonical } = await supabase
    .from("leads")
    .select("*")
    .eq("id", canonicalId)
    .maybeSingle();

  if (currentCanonical && Object.keys(m.field_patch).length > 0) {
    const fp = m.field_patch;
    const revert: Record<string, unknown> = {};
    const currentMap = currentCanonical as unknown as Record<string, unknown>;
    for (const key of Object.keys(fp)) {
      const current = currentMap[key];
      if (JSON.stringify(current) === JSON.stringify(fp[key].new)) {
        revert[key] = fp[key].old;   // restore original, NOT null
      }
    }
    if (Object.keys(revert).length > 0) {
      await supabase
        .from("leads")
        .update(revert)
        .eq("id", canonicalId)
        .eq("tenant_id", tenantId);
    }
  }

  // ── 4. Restore absorbed lead ───────────────────────────────────────────
  await supabase
    .from("leads")
    .update({ deleted_at: null, merged_into: null })
    .eq("id", absorbedId)
    .eq("tenant_id", tenantId);

  // ── 5. Mark merge undone ───────────────────────────────────────────────
  await supabase
    .from("lead_merges")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", mergeId);

  // ── 6. Audit + event ───────────────────────────────────────────────────
  await Promise.all([
    createAuditLog({
      tenantId,
      userId: undoneBy ?? undefined,
      action: "lead.merge_undone",
      entityType: "lead",
      entityId: canonicalId,
      changes: {
        merge_id: { old: mergeId, new: null },
        restored_absorbed_id: { old: null, new: absorbedId },
      },
      requestId,
    }),
    emitEvent({
      tenantId,
      type: "lead.merge_undone",
      entityType: "lead",
      entityId: canonicalId,
      payload: { merge_id: mergeId, restored_absorbed_id: absorbedId },
      requestId,
    }),
  ]);

  return { restoredAbsorbedId: absorbedId, canonicalId };
}
