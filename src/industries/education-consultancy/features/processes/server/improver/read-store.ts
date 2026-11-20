import { must } from "../changes";
import type { ProcessesDb } from "../context";

/**
 * Orca's read on a live version (mockup P4), stored as an `agent_outputs` row of kind `process_read` keyed by the VERSION id
 * (subject_type 'process_version'). Dismiss = status 'dismissed' (hidden until the next read, which is a new row). Plain queries, no embeds.
 */

export const PROCESS_READ_KIND = "process_read";
export const READ_MIN_DAYS_LIVE = 7;

export interface ProcessReadPayload {
  summary: string;
  version: number;
  processId: string;
  usedFallback: boolean;
  generatedAt: string;
}

export interface StoredProcessRead extends ProcessReadPayload {
  id: string;
  versionId: string;
  status: "proposed" | "dismissed";
}

export async function saveProcessRead(
  db: ProcessesDb,
  a: { runId: string; agentId: string; processId: string; versionId: string; version: number; summary: string; usedFallback: boolean; now: Date },
): Promise<void> {
  const payload: ProcessReadPayload = { summary: a.summary, version: a.version, processId: a.processId, usedFallback: a.usedFallback, generatedAt: a.now.toISOString() };
  const { error } = await db.from("agent_outputs").insert({
    run_id: a.runId,
    agent_id: a.agentId,
    kind: PROCESS_READ_KIND,
    subject_type: "process_version",
    subject_id: a.versionId,
    payload,
    status: "proposed",
  });
  if (error) throw new Error(`process read insert: ${error.message}`);
}

/** The newest read for a version, or null. Whether it is still shown (not dismissed) is the caller's call: it sees `status`. */
export async function loadProcessRead(db: ProcessesDb, versionId: string): Promise<StoredProcessRead | null> {
  const rows = must(
    "process read read",
    await db.from("agent_outputs").select("id, subject_id, status, payload").eq("kind", PROCESS_READ_KIND).eq("subject_type", "process_version").eq("subject_id", versionId).order("created_at", { ascending: false }).limit(1),
  ) as unknown as Array<{ id: string; subject_id: string; status: "proposed" | "dismissed"; payload: ProcessReadPayload }> | null;
  const r = rows?.[0];
  return r ? { ...r.payload, id: r.id, versionId: r.subject_id, status: r.status } : null;
}

/** Hide a read. Conditional on it still being `proposed`; false when it was already dismissed or is not this tenant's. */
export async function dismissProcessRead(db: ProcessesDb, versionId: string, userId: string, now: Date): Promise<boolean> {
  const res = await db
    .from("agent_outputs")
    .update({ status: "dismissed", reviewed_by: userId, reviewed_at: now.toISOString() })
    .eq("kind", PROCESS_READ_KIND)
    .eq("subject_type", "process_version")
    .eq("subject_id", versionId)
    .eq("status", "proposed")
    .select("id");
  if (res.error) throw new Error(`process read dismiss: ${res.error.message}`);
  return ((res.data as unknown[] | null)?.length ?? 0) > 0;
}

/** A read is only written for a version that has been live long enough (the same rule as before -> after: under 7 days nothing is claimed). */
export const isOldEnoughForRead = (approvedAt: string | null, now: Date): boolean =>
  !!approvedAt && Math.floor((now.getTime() - Date.parse(approvedAt)) / 86_400_000) >= READ_MIN_DAYS_LIVE;
