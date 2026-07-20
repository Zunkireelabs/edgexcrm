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
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  COMMITMENT_STATUSES,
  timestampsForStatus,
  type CommitmentStatus,
} from "@/industries/real-estate/lib/commitments";

interface Props {
  params: Promise<{ id: string }>;
}

const COMMITMENT_SELECT =
  "*, leads!investor_commitments_lead_id_fkey(id, first_name, last_name, email, phone), offerings!investor_commitments_offering_id_fkey(id, name, currency)";

// PATCH /api/v1/commitments/[id] — update status (funnel card move), amount, notes.
export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/commitments/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const update: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!COMMITMENT_STATUSES.includes(body.status as never)) {
      return apiValidationError({ status: [`Must be one of: ${COMMITMENT_STATUSES.join(", ")}`] });
    }
    const status = body.status as CommitmentStatus;
    update.status = status;
    // Recompute stage timestamps from the new status (also clears higher stages on a move-down).
    Object.assign(update, timestampsForStatus(status));
  }

  if (body.amount !== undefined) {
    if (body.amount === null || body.amount === "") {
      update.amount = null;
    } else {
      const n = Number(body.amount);
      if (!Number.isFinite(n) || n < 0) {
        return apiValidationError({ amount: ["Must be a non-negative number"] });
      }
      update.amount = n;
    }
  }

  if (body.notes !== undefined) {
    update.notes = body.notes === null || body.notes === "" ? null : String(body.notes);
  }

  if (Object.keys(update).length === 0) {
    return apiValidationError({ _: ["No valid fields to update"] });
  }

  const db = await scopedClient(auth);
  // Explicit id filter beyond the auto-injected tenant filter (scopedClient rule).
  const { data, error } = await db
    .from("investor_commitments")
    .update(update)
    .eq("id", id)
    .is("deleted_at", null)
    .select(COMMITMENT_SELECT)
    .maybeSingle();

  if (error) {
    log.error({ error }, "Failed to update commitment");
    return apiError("DB_ERROR", "Failed to update commitment", 500);
  }
  if (!data) return apiNotFound("Commitment");
  return apiSuccess(data);
}

// DELETE /api/v1/commitments/[id] — soft delete (remove investor from raise).
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  // Explicit id filter beyond the auto-injected tenant filter.
  const { data, error } = await db
    .from("investor_commitments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to remove commitment", 500);
  if (!data) return apiNotFound("Commitment");
  return apiSuccess({ id: (data as { id: string }).id, deleted: true });
}
