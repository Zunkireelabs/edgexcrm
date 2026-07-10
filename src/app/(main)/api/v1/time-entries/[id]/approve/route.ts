import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { resolveEffectiveRate } from "@/industries/it-agency/features/time-tracking/lib/rates";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/time-entries/${id}/approve`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  // 1. Fetch the time entry to get project_id and user_id
  const { data: existing, error: fetchError } = await db
    .from("time_entries")
    .select("id, approval_status, user_id, project_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch time entry", 500);
  if (!existing) return apiNotFound("Time entry");

  const row = existing as unknown as {
    id: string;
    approval_status: string;
    user_id: string;
    project_id: string;
  };

  if (row.approval_status !== "pending") {
    return apiError("INVALID_STATE", "Only pending entries can be approved", 409);
  }

  // 2. Parallel fetch: project rate + member rate
  const [projectRes, memberRes] = await Promise.all([
    db
      .from("projects")
      .select("id, default_rate")
      .eq("id", row.project_id)
      .maybeSingle(),
    db
      .from("tenant_users")
      .select("default_hourly_rate, cost_rate")
      .eq("user_id", row.user_id)
      .maybeSingle(),
  ]);

  const project = (projectRes.data as unknown as { id: string; default_rate: number | null } | null) ?? null;
  const member = (memberRes.data as unknown as { default_hourly_rate: number | null; cost_rate: number | null } | null) ?? {
    default_hourly_rate: null,
    cost_rate: null,
  };

  // 3. Compute rate snapshot in app code (before the atomic UPDATE)
  const rateSnapshot = resolveEffectiveRate(project, member);
  // Cost is per-person only (no project-level override) — freeze whatever the
  // member's cost rate is right now, billable or not (you pay for non-billable time).
  const costRateSnapshot = member.cost_rate ?? null;

  // 4. Atomic UPDATE: approval status + rate_snapshot in one write.
  //    .eq("approval_status", "pending") is the TOCTOU precondition — if the
  //    entry was concurrently approved/rejected, the update affects 0 rows.
  const { data: updated, error: updateError } = await db
    .from("time_entries")
    .update({
      approval_status: "approved",
      approved_by: auth.userId,
      approved_at: new Date().toISOString(),
      rate_snapshot: rateSnapshot,
      cost_rate_snapshot: costRateSnapshot,
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("*, projects(id, name, account_id, default_rate, accounts(id, name)), tasks(id, title)")
    .maybeSingle();

  if (updateError) {
    log.error({ error: updateError }, "Failed to approve time entry");
    return apiError("DB_ERROR", "Failed to approve time entry", 500);
  }
  if (!updated) {
    return apiError("INVALID_STATE", "Only pending entries can be approved", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "time_entry.approved",
      entityType: "time_entry",
      entityId: id,
      changes: {
        approval_status: { old: "pending", new: "approved" },
        rate_snapshot: { old: null, new: rateSnapshot },
        cost_rate_snapshot: { old: null, new: costRateSnapshot },
      },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "time_entry.approved",
      entityType: "time_entry",
      entityId: id,
      requestId,
      payload: (() => {
        const u = updated as unknown as { user_id: string; project_id: string; minutes: number; projects: { account_id: string | null } | null };
        return { user_id: u.user_id, project_id: u.project_id, minutes: u.minutes, account_id: u.projects?.account_id ?? null, rate_snapshot: rateSnapshot };
      })(),
    }),
  ]);

  log.info({ entryId: id, rateSnapshot, costRateSnapshot }, "Time entry approved");
  return apiSuccess(updated);
}
