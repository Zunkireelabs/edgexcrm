import { logger } from "@/lib/logger";
import type { scopedClient } from "@/lib/supabase/scoped";

/**
 * The it_agency Delivery Workflow decision ledger. Distinct from
 * `@/lib/api/audit`'s `emitEvent` (generic cross-tenant audit/webhook
 * trail) — `project_events` is a domain-specific, append-only memory
 * seam read back as a project's institutional-memory timeline. Do not
 * conflate the two.
 */
interface RecordProjectEventInput {
  projectId: string;
  eventType: string;
  actorId: string | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
  subjectType?: string | null;
  subjectId?: string | null;
}

export async function recordProjectEvent(
  db: Awaited<ReturnType<typeof scopedClient>>,
  input: RecordProjectEventInput
): Promise<void> {
  const { error } = await db.from("project_events").insert({
    project_id: input.projectId,
    event_type: input.eventType,
    actor_id: input.actorId,
    summary: input.summary ?? null,
    payload: input.payload ?? {},
    subject_type: input.subjectType ?? null,
    subject_id: input.subjectId ?? null,
  });

  if (error) {
    logger.error(
      { err: error, projectId: input.projectId, eventType: input.eventType },
      "Failed to record project event"
    );
  }
}
