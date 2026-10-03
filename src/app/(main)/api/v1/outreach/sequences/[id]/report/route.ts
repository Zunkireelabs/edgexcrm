import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { buildSequenceReport } from "@/industries/_shared/features/outreach/lib/sequence-report";

type Props = { params: Promise<{ id: string }> };

// GET /api/v1/outreach/sequences/[id]/report — how one sequence is doing (see lib/sequence-report.ts). Admin only: it
// counts the whole tenant's leads in the sequence, not just the caller's own.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: "/api/v1/outreach/sequences/[id]/report" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: sequence } = await db.from("email_sequences").select("id, name, auto_send, on_reply").eq("id", id).maybeSingle();
  if (!sequence) return apiNotFound("Sequence");

  const { data: steps } = await db.from("email_sequence_steps").select("step_order").eq("sequence_id", id).order("step_order", { ascending: true });
  const stepOrders = ((steps ?? []) as unknown as { step_order: number }[]).map((s) => s.step_order);

  try {
    const report = await buildSequenceReport(db, id, stepOrders);
    return apiSuccess({ sequence, ...report });
  } catch (err) {
    log.error({ err }, "sequence report failed");
    return apiError("DB_ERROR", "Failed to build the report", 500);
  }
}
