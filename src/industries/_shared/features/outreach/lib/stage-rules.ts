import type { ScopedClient } from "@/lib/supabase/scoped";
import type { OutreachChannel } from "./channel";
import { BULK_ENROLL_MAX_LEADS } from "./bulk-enroll";
import { enrollLeadsAlreadyInStage } from "./stage-auto-enroll";

// Managing a sequence's stage auto-enroll rules (migration 277): which stages a sequence is linked to, "this stage is
// already used by another sequence" detection, and the optional one-time "enroll the leads already in these stages".
// The rule table keeps ONE active rule per (stage, channel); saving a stage that another sequence holds needs an explicit
// `replace` — nothing is ever taken from another sequence silently.

export interface StageRuleRow {
  id: string;
  sequence_id: string;
  list_id: string;
}

export interface StageRuleView {
  listId: string;
  listName: string;
}

export interface TakenStage {
  listId: string;
  listName: string;
  /** The OTHER sequence that currently holds this stage for the same channel. */
  sequenceId: string;
  sequenceName: string;
  /** An archived sequence's leftover rule never blocks anyone — it is cleared automatically. */
  sequenceArchived: boolean;
}

export type SetStagesResult =
  | { ok: true; added: string[]; removed: string[]; replaced: TakenStage[] }
  | { ok: false; reason: "invalid_stage"; invalid: string[] }
  | { ok: false; reason: "taken"; taken: TakenStage[] };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses `{ list_ids: string[] }` — de-duplicated, every entry a UUID, at most 20 stages. */
export function parseStageIds(raw: unknown): { ok: true; listIds: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "list_ids must be an array of stage ids" };
  const ids = [...new Set(raw.map((v) => (typeof v === "string" ? v.trim() : "")))];
  if (ids.some((id) => !UUID_REGEX.test(id))) return { ok: false, error: "Every stage id must be a valid UUID" };
  if (ids.length > 20) return { ok: false, error: "A sequence can auto-enroll from at most 20 stages" };
  return { ok: true, listIds: ids };
}

/** The stages this sequence is linked to (active rules only), with their names, in stage order. */
export async function loadSequenceStages(db: ScopedClient, sequenceId: string): Promise<StageRuleView[]> {
  const { data, error } = await db
    .from("sequence_stage_triggers")
    .select("list_id, lead_lists(name, sort_order)")
    .eq("sequence_id", sequenceId)
    .eq("is_active", true);
  if (error) throw new Error(`Failed to load the sequence's stages: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{ list_id: string; lead_lists: { name: string; sort_order: number } | null }>;
  return rows
    .map((r) => ({ listId: r.list_id, listName: r.lead_lists?.name ?? "Deleted stage", sort: r.lead_lists?.sort_order ?? 0 }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ listId, listName }) => ({ listId, listName }));
}

export interface ActiveStageRule {
  listId: string;
  listName: string;
  sequenceId: string;
  sequenceName: string;
  channel: OutreachChannel;
}

/** Every active rule in the tenant whose sequence is still active (an archived sequence's leftover never counts). */
export async function listActiveStageRules(db: ScopedClient): Promise<ActiveStageRule[]> {
  const { data, error } = await db
    .from("sequence_stage_triggers")
    .select("list_id, sequence_id, channel, lead_lists(name), email_sequences(name, status)")
    .eq("is_active", true);
  if (error) throw new Error(`Failed to load the auto-enroll rules: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    list_id: string;
    sequence_id: string;
    channel: string;
    lead_lists: { name: string } | null;
    email_sequences: { name: string; status: string } | null;
  }>;
  return rows
    .filter((r) => r.email_sequences?.status === "active")
    .map((r) => ({
      listId: r.list_id,
      listName: r.lead_lists?.name ?? "Deleted stage",
      sequenceId: r.sequence_id,
      sequenceName: r.email_sequences?.name ?? "Deleted sequence",
      channel: r.channel === "sms" ? ("sms" as const) : ("email" as const),
    }));
}

/** Of `listIds`, the ones another ACTIVE sequence already holds on this channel. */
export async function findTakenStages(db: ScopedClient, sequenceId: string, channel: OutreachChannel, listIds: string[]): Promise<TakenStage[]> {
  if (listIds.length === 0) return [];
  const { data, error } = await db
    .from("sequence_stage_triggers")
    .select("list_id, sequence_id, lead_lists(name), email_sequences(name, status)")
    .eq("is_active", true)
    .eq("channel", channel)
    .in("list_id", listIds);
  if (error) throw new Error(`Failed to check the stages: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    list_id: string;
    sequence_id: string;
    lead_lists: { name: string } | null;
    email_sequences: { name: string; status: string } | null;
  }>;
  return rows
    .filter((r) => r.sequence_id !== sequenceId)
    .map((r) => ({
      listId: r.list_id,
      listName: r.lead_lists?.name ?? "Deleted stage",
      sequenceId: r.sequence_id,
      sequenceName: r.email_sequences?.name ?? "Deleted sequence",
      sequenceArchived: !r.email_sequences || r.email_sequences.status !== "active",
    }));
}

/**
 * Makes the sequence's linked stages exactly `listIds` (an empty list switches auto-enroll off). Stages the sequence no
 * longer lists are unlinked; stages another sequence holds are refused unless `replace` is true, in which case that other
 * sequence loses them (leads it already auto-enrolled keep running — only NEW entries change).
 */
export async function setSequenceStages(
  db: ScopedClient,
  params: { sequenceId: string; channel: OutreachChannel; listIds: string[]; createdBy: string; replace: boolean }
): Promise<SetStagesResult> {
  const { sequenceId, channel, listIds, createdBy, replace } = params;

  if (listIds.length > 0) {
    const { data: lists, error } = await db.from("lead_lists").select("id, is_archive").in("id", listIds);
    if (error) throw new Error(`Failed to check the stages: ${error.message}`);
    const valid = new Set(((lists ?? []) as unknown as Array<{ id: string; is_archive: boolean }>).filter((l) => !l.is_archive).map((l) => l.id));
    const invalid = listIds.filter((id) => !valid.has(id));
    if (invalid.length > 0) return { ok: false, reason: "invalid_stage", invalid };
  }

  const holders = await findTakenStages(db, sequenceId, channel, listIds);
  const taken = holders.filter((t) => !t.sequenceArchived);
  const stale = holders.filter((t) => t.sequenceArchived);
  if (taken.length > 0 && !replace) return { ok: false, reason: "taken", taken };

  const current = await loadSequenceStages(db, sequenceId);
  const currentIds = new Set(current.map((c) => c.listId));
  const wanted = new Set(listIds);
  const removed = [...currentIds].filter((id) => !wanted.has(id));
  const added = listIds.filter((id) => !currentIds.has(id));

  // Order matters for the unique index (one active rule per stage per channel): free the stages first, then claim them.
  for (const t of [...taken, ...stale]) {
    const { error } = await db.from("sequence_stage_triggers").delete().eq("sequence_id", t.sequenceId).eq("list_id", t.listId);
    if (error) throw new Error(`Failed to free the stage "${t.listName}": ${error.message}`);
  }
  for (const listId of removed) {
    const { error } = await db.from("sequence_stage_triggers").delete().eq("sequence_id", sequenceId).eq("list_id", listId);
    if (error) throw new Error(`Failed to unlink a stage: ${error.message}`);
  }
  if (added.length > 0) {
    const { error } = await db
      .from("sequence_stage_triggers")
      .insert(added.map((listId) => ({ sequence_id: sequenceId, list_id: listId, channel, is_active: true, created_by: createdBy })));
    if (error) throw new Error(`Failed to link the stages: ${error.message}`);
  }
  return { ok: true, added, removed, replaced: taken };
}

/** How many (not deleted) leads sit in these stages right now — the number shown on "Also enroll the N leads already in…". */
export async function countLeadsInStages(db: ScopedClient, listIds: string[]): Promise<number> {
  if (listIds.length === 0) return 0;
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .in("list_id", listIds)
    .is("deleted_at", null);
  if (error) throw new Error(`Failed to count the leads: ${error.message}`);
  return count ?? 0;
}

/**
 * One-time: enroll the leads already sitting in `listIds` (capped at the bulk limit). Goes through the same run + worker as
 * a stage move, so opted-out leads, leads auto-enrolled before, and leads in a running sequence are handled identically.
 * Returns how many leads were handed to runs.
 */
export async function enrollExistingLeadsInStages(
  db: ScopedClient,
  tenantId: string,
  params: { sequenceId: string; channel: OutreachChannel; listIds: string[]; createdBy: string }
): Promise<{ leadsQueued: number; capped: boolean }> {
  let leadsQueued = 0;
  let capped = false;
  for (const listId of params.listIds) {
    const remaining = BULK_ENROLL_MAX_LEADS - leadsQueued;
    if (remaining <= 0) {
      capped = true;
      break;
    }
    const res = await enrollLeadsAlreadyInStage(db, tenantId, {
      sequenceId: params.sequenceId,
      channel: params.channel,
      listId,
      createdBy: params.createdBy,
      limit: remaining,
    });
    leadsQueued += res.leadsQueued;
    if (res.capped) capped = true;
  }
  return { leadsQueued, capped };
}

