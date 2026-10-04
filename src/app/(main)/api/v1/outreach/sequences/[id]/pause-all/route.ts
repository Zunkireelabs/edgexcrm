import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { emitEvent } from "@/lib/api/audit";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

type Props = { params: Promise<{ id: string }> };

// "Pause all" / "Resume all" for ONE sequence — the emergency stop for a bad email in a big run.
//   POST { action: "pause" }   every ACTIVE enrollment -> paused, stop_reason 'sequence_paused'
//   POST { action: "resume" }  ONLY the enrollments paused by "Pause all" -> active again
// A lead paused because they replied (stop_reason 'replied') or paused by a rep (stop_reason NULL) is never
// touched by either. Nothing sends for a paused enrollment (drafts, Send now, scheduled sends and auto-send
// all require an active enrollment). Admin only.

async function countWhere(
  db: Awaited<ReturnType<typeof scopedClient>>,
  sequenceId: string,
  status: string,
  stopReason: string | null | undefined
): Promise<number> {
  let q = db
    .from("sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequenceId)
    .eq("status", status);
  if (stopReason === null) q = q.is("stop_reason", null);
  else if (stopReason !== undefined) q = q.eq("stop_reason", stopReason);
  const { count } = await q;
  return count ?? 0;
}

// GET — the numbers the confirm dialog shows.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: seq } = await db.from("email_sequences").select("id").eq("id", id).maybeSingle();
  if (!seq) return apiNotFound("Sequence");

  const [active, pausedByStopAll, pausedOther] = await Promise.all([
    countWhere(db, id, "active", undefined),
    countWhere(db, id, "paused", "sequence_paused"),
    countWhere(db, id, "paused", undefined).then(async (all) => all - (await countWhere(db, id, "paused", "sequence_paused"))),
  ]);
  return apiSuccess({ active, paused_by_stop_all: pausedByStopAll, paused_other: pausedOther });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/outreach/sequences/[id]/pause-all" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const action = body.action;
  if (action !== "pause" && action !== "resume") {
    return apiValidationError({ action: ["Must be one of: pause, resume"] });
  }

  const db = await scopedClient(auth);
  const { data: seq } = await db.from("email_sequences").select("id").eq("id", id).maybeSingle();
  if (!seq) return apiNotFound("Sequence");

  const nowIso = new Date().toISOString();
  const query =
    action === "pause"
      ? db
          .from("sequence_enrollments")
          .update({ status: "paused", stop_reason: "sequence_paused", stopped_at: nowIso })
          .eq("sequence_id", id)
          .eq("status", "active")
      : db
          .from("sequence_enrollments")
          .update({ status: "active", stop_reason: null, stopped_at: null })
          .eq("sequence_id", id)
          .eq("status", "paused")
          .eq("stop_reason", "sequence_paused");
  const { data, error } = await query.select("id");
  if (error) {
    log.error({ error }, "pause-all failed");
    return apiError("DB_ERROR", `Failed to ${action} the sequence`, 500);
  }
  const affected = (data ?? []).length;

  await emitEvent({
    tenantId: auth.tenantId,
    type: action === "pause" ? "sequence.paused_all" : "sequence.resumed_all",
    entityType: "email_sequence",
    entityId: id,
    payload: { affected, by: auth.userId },
  });

  log.info({ sequenceId: id, action, affected }, "Sequence pause-all");
  return apiSuccess({ action, affected });
}
