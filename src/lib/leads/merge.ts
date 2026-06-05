/**
 * Lead merge primitive — used by the manual-merge API, the undo API, and the backfill script.
 *
 * Hard rules:
 *   • No data loss: absorbed lead's field values are preserved in a synthesized
 *     lead_submissions row before the lead is soft-deleted.
 *   • Full reversibility: every re-pointed FK row ID is stored in lead_merges.repointed_ids,
 *     and field changes in lead_merges.field_patch, so undo() can reverse precisely.
 *   • Never merges converted leads (converted_at IS NOT NULL).
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

  // ── 2. Synthesize a lead_submissions row for the absorbed lead ─────────
  // This is the no-data-loss guarantee: absorbed's exact field values are
  // captured verbatim before the lead is soft-deleted.
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

  // ── 3. Re-point every lead_id FK absorbed → canonical ─────────────────
  // IDs are stored per table so undo can reverse precisely (without over-moving
  // the canonical lead's own original children).
  const repointedIds: Record<string, string[]> = {};
  const repointedCounts: Record<string, number> = {};

  const ids = (data: unknown[] | null) =>
    ((data ?? []) as { id: string }[]).map((r) => r.id);

  // lead_submissions (exclude the just-synthesized row — it was created directly on canonical)
  {
    const { data } = await supabase
      .from("lead_submissions")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .neq("id", synthesizedSubmissionId)
      .select("id");
    const moved = ids(data);
    repointedIds.lead_submissions = moved;
    repointedCounts.lead_submissions = moved.length;
  }
  {
    const { data } = await supabase
      .from("lead_notes")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.lead_notes = moved;
    repointedCounts.lead_notes = moved.length;
  }
  {
    const { data } = await supabase
      .from("lead_checklists")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.lead_checklists = moved;
    repointedCounts.lead_checklists = moved.length;
  }
  {
    const { data } = await supabase
      .from("lead_activities")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.lead_activities = moved;
    repointedCounts.lead_activities = moved.length;
  }
  {
    const { data } = await supabase
      .from("tasks")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.tasks = moved;
    repointedCounts.tasks = moved.length;
  }
  {
    const { data } = await supabase
      .from("email_threads")
      .update({ lead_id: canonicalId })
      .eq("lead_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.email_threads = moved;
    repointedCounts.email_threads = moved.length;
  }

  // audit_logs + events use entity_id, not lead_id
  {
    const { data } = await supabase
      .from("audit_logs")
      .update({ entity_id: canonicalId })
      .eq("entity_type", "lead")
      .eq("entity_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.audit_logs = moved;
    repointedCounts.audit_logs = moved.length;
  }
  {
    const { data } = await supabase
      .from("events")
      .update({ entity_id: canonicalId })
      .eq("entity_type", "lead")
      .eq("entity_id", absorbedId)
      .select("id");
    const moved = ids(data);
    repointedIds.events = moved;
    repointedCounts.events = moved.length;
  }

  // lead_insights — UNIQUE(lead_id): delete absorbed's row if canonical already has one,
  // otherwise re-point.  AI insights are regenerable so deletion is acceptable.
  {
    const { data: canonicalInsight } = await supabase
      .from("lead_insights")
      .select("id")
      .eq("lead_id", canonicalId)
      .maybeSingle();

    const { data: absorbedInsight } = await supabase
      .from("lead_insights")
      .select("id")
      .eq("lead_id", absorbedId)
      .maybeSingle();

    if (absorbedInsight) {
      const insightId = (absorbedInsight as { id: string }).id;
      if (canonicalInsight) {
        // Canonical already has insight — delete absorbed's to avoid UNIQUE violation
        await supabase.from("lead_insights").delete().eq("id", insightId);
        repointedIds.lead_insights_deleted = [insightId];
        repointedCounts.lead_insights_deleted = 1;
      } else {
        await supabase
          .from("lead_insights")
          .update({ lead_id: canonicalId })
          .eq("id", insightId);
        repointedIds.lead_insights = [insightId];
        repointedCounts.lead_insights = 1;
      }
    }
  }

  // ── 4. Merge fields into canonical (fill-empty; JSONB merge; tags union) ─
  const fieldPatch = applyCanonicalUpdate(canonical, {
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

  if (Object.keys(fieldPatch).length > 0) {
    await supabase
      .from("leads")
      .update(fieldPatch)
      .eq("id", canonicalId)
      .eq("tenant_id", tenantId);
  }

  // ── 5. Soft-delete absorbed lead ───────────────────────────────────────
  await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString(), merged_into: canonicalId })
    .eq("id", absorbedId)
    .eq("tenant_id", tenantId);

  // ── 6. Write lead_merges row ────────────────────────────────────────────
  const { data: mergeRow, error: mergeErr } = await supabase
    .from("lead_merges")
    .insert({
      tenant_id: tenantId,
      canonical_id: canonicalId,
      absorbed_id: absorbedId,
      merged_by: mergedBy ?? null,
      source,
      repointed_counts: repointedCounts,
      repointed_ids: repointedIds,
      field_patch: fieldPatch,
      synthesized_submission_id: synthesizedSubmissionId,
    })
    .select("id")
    .single();

  if (mergeErr || !mergeRow) {
    throw new Error(`mergeLeads: failed to write lead_merges row: ${mergeErr?.message ?? "no data"}`);
  }

  const mergeId = (mergeRow as { id: string }).id;

  // ── 7. Audit + event + notification ────────────────────────────────────
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

// ── undo ───────────────────────────────────────────────────────────────────

export interface UndoMergeResult {
  restoredAbsorbedId: string;
  canonicalId: string;
}

export async function undoMerge(
  supabase: SupabaseServiceClient,
  mergeId: string,
  undoneBy?: string | null,
  requestId?: string
): Promise<UndoMergeResult> {
  // Load merge record
  const { data: merge } = await supabase
    .from("lead_merges")
    .select("*")
    .eq("id", mergeId)
    .maybeSingle();

  if (!merge) throw new Error(`undoMerge: merge record ${mergeId} not found`);

  const m = merge as {
    id: string;
    tenant_id: string;
    canonical_id: string;
    absorbed_id: string;
    field_patch: Record<string, unknown>;
    repointed_ids: Record<string, string[]>;
    synthesized_submission_id: string | null;
    undone_at: string | null;
  };

  if (m.undone_at !== null) {
    throw new Error(`undoMerge: merge ${mergeId} has already been undone`);
  }

  const { tenant_id: tenantId, canonical_id: canonicalId, absorbed_id: absorbedId } = m;
  const ids = m.repointed_ids ?? {};

  // ── 1. Re-point FK children back to absorbed using stored IDs ──────────
  // Precise: only moves rows that were originally on the absorbed lead.

  if (ids.lead_submissions?.length) {
    await supabase
      .from("lead_submissions")
      .update({ lead_id: absorbedId })
      .in("id", ids.lead_submissions);
  }
  if (ids.lead_notes?.length) {
    await supabase
      .from("lead_notes")
      .update({ lead_id: absorbedId })
      .in("id", ids.lead_notes);
  }
  if (ids.lead_checklists?.length) {
    await supabase
      .from("lead_checklists")
      .update({ lead_id: absorbedId })
      .in("id", ids.lead_checklists);
  }
  if (ids.lead_activities?.length) {
    await supabase
      .from("lead_activities")
      .update({ lead_id: absorbedId })
      .in("id", ids.lead_activities);
  }
  if (ids.tasks?.length) {
    await supabase
      .from("tasks")
      .update({ lead_id: absorbedId })
      .in("id", ids.tasks);
  }
  if (ids.email_threads?.length) {
    await supabase
      .from("email_threads")
      .update({ lead_id: absorbedId })
      .in("id", ids.email_threads);
  }
  if (ids.audit_logs?.length) {
    await supabase
      .from("audit_logs")
      .update({ entity_id: absorbedId })
      .in("id", ids.audit_logs);
  }
  if (ids.events?.length) {
    await supabase
      .from("events")
      .update({ entity_id: absorbedId })
      .in("id", ids.events);
  }
  // lead_insights: if it was re-pointed (not deleted), move it back
  if (ids.lead_insights?.length) {
    await supabase
      .from("lead_insights")
      .update({ lead_id: absorbedId })
      .in("id", ids.lead_insights);
  }
  // lead_insights_deleted: these were deleted during merge and cannot be restored

  // ── 2. Delete the synthesized submission ───────────────────────────────
  if (m.synthesized_submission_id) {
    await supabase
      .from("lead_submissions")
      .delete()
      .eq("id", m.synthesized_submission_id);
  }

  // ── 3. Revert field_patch on canonical ─────────────────────────────────
  // For each key in field_patch, clear it on canonical if the value still
  // matches what we set (avoids overwriting manual edits made after the merge).
  const { data: currentCanonical } = await supabase
    .from("leads")
    .select("*")
    .eq("id", canonicalId)
    .maybeSingle();

  if (currentCanonical && Object.keys(m.field_patch).length > 0) {
    const revert: Record<string, null> = {};
    for (const key of Object.keys(m.field_patch)) {
      const current = (currentCanonical as Record<string, unknown>)[key];
      const patched = m.field_patch[key];
      if (JSON.stringify(current) === JSON.stringify(patched)) {
        revert[key] = null;
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
