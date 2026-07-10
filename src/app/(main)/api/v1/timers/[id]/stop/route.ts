import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const TIME_ENTRY_SELECT =
  "*, projects(id, name, account_id, default_rate, accounts(id, name)), tasks(id, title)";

interface Props {
  params: Promise<{ id: string }>;
}

interface ClaimedTimer {
  id: string;
  task_id: string;
  project_id: string;
  user_id: string;
  started_at: string;
}

/** Calendar date of `instant` in `timezone`, as YYYY-MM-DD (matches src/lib/hr/dates.ts's todayInTz, but for an arbitrary instant instead of "now"). */
function dateInTz(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/timers/${id}/stop`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const isAdmin = requireAdmin(auth);

  // Atomic claim: conditional delete. Only the caller that actually deletes a row
  // "wins" the stop — a concurrent stop, or a timer that never existed / isn't
  // owned by this user, both resolve to zero rows here (not distinguishable, and
  // that's fine: both are correctly reported as "no longer running").
  let claimQuery = db.from("active_timers").delete().eq("id", id);
  if (!isAdmin) claimQuery = claimQuery.eq("user_id", auth.userId);
  const { data: claimed, error: claimError } = await claimQuery
    .select("id, task_id, project_id, user_id, started_at")
    .maybeSingle();

  if (claimError) {
    log.error({ error: claimError }, "Failed to claim timer for stop");
    return apiError("DB_ERROR", "Failed to stop timer", 500);
  }
  if (!claimed) {
    return apiError("ALREADY_STOPPED", "Timer is no longer running", 409);
  }

  const timer = claimed as unknown as ClaimedTimer;
  const minutes = Math.max(1, Math.round((Date.now() - new Date(timer.started_at).getTime()) / 60000));

  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const timezone = (tenantRow as { timezone: string } | null)?.timezone ?? "Asia/Kathmandu";
  const entryDate = dateInTz(timer.started_at, timezone);

  const { data: task } = await db.from("tasks").select("is_billable").eq("id", timer.task_id).maybeSingle();
  const isBillable = (task as { is_billable: boolean } | null)?.is_billable ?? true;

  const { data: created, error } = await db
    .from("time_entries")
    .insert({
      user_id: timer.user_id,
      project_id: timer.project_id,
      task_id: timer.task_id,
      entry_date: entryDate,
      minutes,
      notes: null,
      is_billable: isBillable,
      approval_status: "pending",
      rate_snapshot: null,
      source: "timer",
    })
    .select(TIME_ENTRY_SELECT)
    .single();

  if (error) {
    // Delete-first trade-off: the timer is already gone at this point, so a failed
    // insert loses the elapsed time. Preferred over insert-first (which risks a
    // double-charge on a concurrent stop); this is a DB-outage-class event.
    log.error({ error, timerId: id }, "Failed to log timer time");
    return apiError("DB_ERROR", "Failed to log timer time", 500);
  }

  const createdEntry = created as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: timer.user_id,
      action: "time_entry.created",
      entityType: "time_entry",
      entityId: createdEntry.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "time_entry.created",
      entityType: "time_entry",
      entityId: createdEntry.id,
      requestId,
    }),
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "timer.stopped",
      entityType: "active_timer",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ timerId: id, entryId: createdEntry.id, minutes }, "Timer stopped");
  return apiSuccess(created, 201);
}
