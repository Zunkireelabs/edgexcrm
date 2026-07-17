import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { isUUID } from "@/lib/api/validation";
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
  "*, leads!investor_commitments_lead_id_fkey(id, first_name, last_name, email, phone)";

// GET /api/v1/offerings/[id]/commitments — funnel rows for one offering.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id: offeringId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();

  const db = await scopedClient(auth);

  // Confirm the offering is in this tenant (RLS also enforces, but 404 is cleaner).
  const { data: offering } = await db
    .from("offerings")
    .select("id")
    .eq("id", offeringId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!offering) return apiNotFound("Offering");

  const { data, error } = await db
    .from("investor_commitments")
    .select(COMMITMENT_SELECT)
    .eq("offering_id", offeringId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch commitments", 500);
  return apiSuccess(data ?? []);
}

// POST /api/v1/offerings/[id]/commitments — add an investor (lead) to the raise.
export async function POST(request: NextRequest, { params }: Props) {
  const { id: offeringId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/offerings/${offeringId}/commitments` });

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

  const leadId = body.lead_id ? String(body.lead_id) : "";
  if (!leadId || isUUID()(leadId)) {
    return apiValidationError({ lead_id: ["A valid investor (lead_id) is required"] });
  }

  let status: CommitmentStatus = "prospect";
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!COMMITMENT_STATUSES.includes(body.status as never)) {
      return apiValidationError({ status: [`Must be one of: ${COMMITMENT_STATUSES.join(", ")}`] });
    }
    status = body.status as CommitmentStatus;
  }

  let amount: number | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const n = Number(body.amount);
    if (!Number.isFinite(n) || n < 0) {
      return apiValidationError({ amount: ["Must be a non-negative number"] });
    }
    amount = n;
  }

  const db = await scopedClient(auth);

  // Both FKs must resolve inside this tenant (scopedClient auto-filters tenant_id).
  const { data: offering } = await db
    .from("offerings")
    .select("id")
    .eq("id", offeringId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!offering) return apiNotFound("Offering");

  const { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Investor");

  const insert: Record<string, unknown> = {
    lead_id: leadId,
    offering_id: offeringId,
    status,
    amount,
    created_by: auth.userId,
    ...timestampsForStatus(status),
  };
  if (body.notes) insert.notes = String(body.notes);

  const { data: created, error } = await db
    .from("investor_commitments")
    .insert(insert)
    .select(COMMITMENT_SELECT)
    .single();

  if (error) {
    // Partial unique index (lead_id, offering_id) WHERE deleted_at IS NULL.
    if (error.code === "23505") {
      return apiConflict("This investor is already on this raise");
    }
    log.error({ error }, "Failed to create commitment");
    return apiError("DB_ERROR", "Failed to add investor to raise", 500);
  }

  return apiSuccess(created, 201);
}
