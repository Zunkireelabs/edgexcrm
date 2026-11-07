import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiForbidden, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canUndo } from "@/industries/education-consultancy/features/home/lib/assignment/outcome";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 100;

// POST /api/v1/home/assignment/undo  { decision_ids: string[] }
// "Undo" on the auto-assignment FYI row. Owner / admin. Each decision must still be open and its lead still with the person
// smart assignment picked; the lead goes back to unassigned through the normal audited lead patch (as the person clicking),
// and the decision is recorded as "undone", which counts against the pick like a disagreement.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const ids = body.decision_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX || ids.some((i) => typeof i !== "string" || !UUID_RE.test(i))) {
    return apiValidationError({ decision_ids: [`Between 1 and ${MAX} decision ids are required`] });
  }

  const db = await scopedClient(auth);
  const { data: decisions } = await db.from("lead_assignment_decisions").select("id, lead_id, mode, picked_user_id, outcome").in("id", ids as string[]);
  const rows = (decisions ?? []) as unknown as Array<{ id: string; lead_id: string; mode: "shadow" | "auto"; picked_user_id: string | null; outcome: "matched" | "overridden" | "undone" | null }>;
  const { data: leads } = await db.from("leads").select("id, assigned_to").in("id", rows.map((r) => r.lead_id));
  const assignee = new Map(((leads ?? []) as unknown as Array<{ id: string; assigned_to: string | null }>).map((l) => [l.id, l.assigned_to]));

  let undone = 0;
  let skipped = 0;
  for (const d of rows) {
    if (!canUndo({ mode: d.mode, pickedUserId: d.picked_user_id, outcome: d.outcome }, assignee.get(d.lead_id) ?? null)) {
      skipped += 1;
      continue;
    }
    const outcome = await applyLeadPatch(auth, d.lead_id, { assigned_to: null }, { requestId: crypto.randomUUID(), ip: null, userAgent: "smart-assignment-undo" });
    if (outcome.kind !== "ok") {
      skipped += 1;
      continue;
    }
    await db.from("lead_assignment_decisions").update({ outcome: "undone", outcome_at: new Date().toISOString(), outcome_by: auth.userId, final_user_id: null }).eq("id", d.id).is("outcome", null);
    undone += 1;
  }
  return apiSuccess({ undone, skipped });
}
