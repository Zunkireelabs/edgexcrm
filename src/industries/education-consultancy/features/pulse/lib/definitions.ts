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
  /** changes.holder.new on the move's own audit row. */
  holderNew?: string | null;
  /** changes.assigned_to.new on the same audit row. */
  assignedToNew?: string | null;
  /** assignee reconstructed from the latest prior assigned_to audit change, if any. */
  priorAssignee?: string | null;
  /** leads.assigned_to now. */
  currentAssignee?: string | null;
}
export type HolderSource = "holder" | "assigned_to" | "prior_audit" | "current_fallback" | "none";

export function resolveHolder(i: HolderInput): { userId: string | null; source: HolderSource } {
  if (i.holderNew) return { userId: i.holderNew, source: "holder" };
  if (i.assignedToNew) return { userId: i.assignedToNew, source: "assigned_to" };
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
    if (r.via === "bulk") {
      bulk.add(r.id);
      continue;
    }
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
