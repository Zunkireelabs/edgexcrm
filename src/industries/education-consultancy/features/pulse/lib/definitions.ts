/**
 * Pure TypeScript statement of Pulse's binding definitions (brief §2). The RPCs in migration 280 implement the
 * same rules in SQL for volume; these functions are the readable spec, unit-tested, and used to post-process
 * RPC rows (name→list mapping, bulk heuristic parity checks, de-duplication).
 */

export interface ListRef {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isArchive: boolean;
  adminOnly: boolean;
}

export type MoveDirection = "forward" | "back" | "lateral" | "unknown";

export function classifyMove(from: ListRef | null, to: ListRef | null): MoveDirection {
  if (!from || !to) return "unknown";
  if (to.sortOrder > from.sortOrder) return "forward";
  if (to.sortOrder < from.sortOrder) return "back";
  return "lateral";
}

/** "Out" = a back move, or any move into the archived list. */
export function isOutMove(from: ListRef | null, to: ListRef | null): boolean {
  if (!to) return false;
  if (to.isArchive) return true;
  return classifyMove(from, to) === "back";
}

export interface ListIndex {
  byId: Map<string, ListRef>;
  byName: Map<string, ListRef>;
  bySlug: Map<string, ListRef>;
}

export function indexLists(lists: ListRef[]): ListIndex {
  return {
    byId: new Map(lists.map((l) => [l.id, l])),
    byName: new Map(lists.map((l) => [l.name.trim().toLowerCase(), l])),
    bySlug: new Map(lists.map((l) => [l.slug.trim().toLowerCase(), l])),
  };
}

export type ResolvedVia = "id" | "name" | "slug" | "unmatched";

/**
 * Resolve one side of a stage move. Ids win (written from EDGEX-82 on); otherwise match the stored string by
 * list name, then by slug (check-in historically wrote the slug into `list.old`). Unmatched → null, bucketed
 * as "Other stage" by the caller and counted separately for slug-shaped vs name-shaped rows.
 */
export function resolveListRef(
  index: ListIndex,
  id: string | null | undefined,
  label: string | null | undefined,
): { list: ListRef | null; via: ResolvedVia } {
  if (id) {
    const hit = index.byId.get(id);
    if (hit) return { list: hit, via: "id" };
  }
  if (label) {
    const key = label.trim().toLowerCase();
    const byName = index.byName.get(key);
    if (byName) return { list: byName, via: "name" };
    const bySlug = index.bySlug.get(key);
    if (bySlug) return { list: bySlug, via: "slug" };
  }
  return { list: null, via: "unmatched" };
}

export interface HolderInput {
  /** The assignee changed in this very event (changes.assigned_to old ≠ new). */
  assignChanged?: boolean;
  /** changes.assigned_to.old — who held the lead before the hand-off. */
  assignedOld?: string | null;
  /** The person who made the move (audit_logs.user_id). */
  actorId?: string | null;
  /** changes.holder.new — when the assignee did NOT change this is the holder before AND after. */
  holderNew?: string | null;
  /** assignee reconstructed from the latest prior assigned_to audit change, if any. */
  priorAssignee?: string | null;
  /** leads.assigned_to now. */
  currentAssignee?: string | null;
}
export type HolderSource = "assigned_to" | "actor" | "holder" | "prior_audit" | "current_fallback" | "none";

/**
 * Who delivered the lead to the stage = the holder IMMEDIATELY BEFORE the move (review round 1).
 *
 * The relay re-assigns a lead in the same event that moves it forward (Counsellor → App Executive when it enters
 * Applications), so the holder AFTER the move is the NEXT person in the chain. Crediting them would credit the
 * receiver for the sender's work. Order:
 *   1. assigned_to.old when the assignee changed in this event — if nobody held it, the actor delivered it;
 *   2. otherwise the assignee did not change, so holder.new is the holder before (and after);
 *   3. rows without holder: the latest prior assigned_to audit change, then the current assignee (a reported fallback).
 */
export function resolveHolder(i: HolderInput): { userId: string | null; source: HolderSource } {
  if (i.assignChanged) {
    return i.assignedOld ? { userId: i.assignedOld, source: "assigned_to" } : { userId: i.actorId ?? null, source: i.actorId ? "actor" : "none" };
  }
  if (i.holderNew) return { userId: i.holderNew, source: "holder" };
  if (i.priorAssignee) return { userId: i.priorAssignee, source: "prior_audit" };
  if (i.currentAssignee) return { userId: i.currentAssignee, source: "current_fallback" };
  return { userId: null, source: "none" };
}

export interface MoveRow {
  id: string;
  actorId: string | null;
  at: Date;
  /** explicit tag written from EDGEX-82 on */
  via?: string | null;
}

/**
 * A stage move is bulk if it is tagged `via = bulk`, or (historical) the same actor wrote >= minRows stage-move
 * rows inside the same `bucketSeconds` bucket. Exactly minRows qualifies; minRows-1 does not.
 */
export function bulkMoveIds(rows: MoveRow[], minRows: number, bucketSeconds: number): Set<string> {
  const bulk = new Set<string>();
  const buckets = new Map<string, string[]>();
  for (const r of rows) {
    // Mirrors education_pulse_moves (SQL): tagged rows are bulk AND still count toward their actor's bucket, so an
    // untagged straggler in the same 60s as a tagged batch is swept in too.
    if (r.via === "bulk") bulk.add(r.id);
    const bucket = Math.floor(r.at.getTime() / 1000 / bucketSeconds);
    const key = `${r.actorId ?? "none"}:${bucket}`;
    const list = buckets.get(key);
    if (list) list.push(r.id);
    else buckets.set(key, [r.id]);
  }
  for (const ids of buckets.values()) {
    if (ids.length >= minRows) ids.forEach((id) => bulk.add(id));
  }
  return bulk;
}

/** Notes: "edited in window" = edited_at in window and more than 1 minute after created_at. */
export function isEditedNote(createdAt: Date, editedAt: Date | null): boolean {
  return !!editedAt && editedAt.getTime() > createdAt.getTime() + 60_000;
}

export interface NoteLike {
  aiToolCallId: string | null;
  leadDeleted: boolean;
}
export function noteCounts(n: NoteLike): boolean {
  return n.aiToolCallId === null && !n.leadDeleted;
}

/**
 * "New leads received": audit assignments in the window ∪ leads created in the window already assigned to the
 * person — de-duplicated by lead, so a lead created-and-assigned in the window (which can appear in both
 * sources) counts once per person.
 */
export function dedupeReceived(
  auditAssignments: Array<{ leadId: string; userId: string }>,
  createdAssigned: Array<{ leadId: string; userId: string }>,
): Map<string, number> {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const r of [...auditAssignments, ...createdAssigned]) {
    const k = `${r.userId}:${r.leadId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  }
  return out;
}

/**
 * Stage-to-stage conversion: of the leads that were in stage N during the window (held at its start + entered in it),
 * the share that moved FORWARD out of N in the window. By construction every lead that moved forward out of N is in
 * the base, so this can never exceed 100% (the old "entered N+1 ÷ entered N" could: 12 ÷ 10 = 120%).
 * null when there is nothing to divide by.
 */
export function stageConversion(forwardFromStage: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.min(1, Math.max(0, forwardFromStage / base));
}
