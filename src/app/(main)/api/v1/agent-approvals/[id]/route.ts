import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { inngest } from "@/lib/inngest/client";
import { APPROVAL_DECIDED_EVENT } from "@/lib/ai/agents/approval-flow";

const DECISIONS = ["approve", "reject"] as const;
type Decision = (typeof DECISIONS)[number];

const DECISION_TO_STATUS: Record<Decision, "approved" | "rejected"> = {
  approve: "approved",
  reject: "rejected",
};

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Decides a pending agent_approvals row (5.4b). Mirrors
 * agent-outputs/[id]/route.ts's shape: owner/admin, tenant-scoped via
 * scopedClient, only a 'pending' row is decidable. Persists the decision
 * here (so it's durable even if no Inngest function is currently waiting on
 * it — e.g. its 48h wait already elapsed) and separately notifies the
 * waiting step.waitForEvent via an Inngest event, which only matters while
 * that step is still live.
 */
export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/agent-approvals/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (!DECISIONS.includes(body.decision as Decision)) {
    return apiValidationError({ decision: ["decision must be 'approve' or 'reject'"] });
  }
  const decision = body.decision as Decision;

  const db = await scopedClient(auth);

  const { data: existingRaw } = await db.from("agent_approvals").select("id, status").eq("id", id).maybeSingle();
  const existing = existingRaw as unknown as { id: string; status: string } | null;
  if (!existing) return apiNotFound("Agent approval");

  if (existing.status !== "pending") {
    return apiValidationError({ decision: ["This approval has already been decided"] });
  }

  const nextStatus = DECISION_TO_STATUS[decision];

  const { data, error } = await db
    .from("agent_approvals")
    .update({ status: nextStatus, decided_by: auth.userId, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, run_id, tool_id, tool_input, status, decided_by, decided_at, requested_at, expires_at")
    .single();

  if (error) {
    log.error({ error }, "Failed to update agent approval");
    return apiError("DB_ERROR", "Failed to update agent approval", 500);
  }

  try {
    await inngest.send({ name: APPROVAL_DECIDED_EVENT, data: { approvalId: id, decision: nextStatus } });
  } catch (err) {
    // Non-blocking: the decision is already durably persisted above. If the
    // waiting Inngest step never sees this event, its wait eventually times
    // out and tries to mark the row 'expired' — but expireApproval() only
    // updates rows still 'pending', so the already-decided status here
    // stands either way.
    log.error({ err, approvalId: id }, "Failed to send approval.decided event (non-blocking)");
  }

  log.info({ approvalId: id, status: nextStatus }, "Agent approval decided");
  return apiSuccess(data);
}
