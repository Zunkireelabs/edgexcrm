import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/[id]/commitments — an investor's commitments across all offerings.
// real_estate-only (feature-gated); additive sub-route, does not alter leads behavior
// for any other industry.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id: leadId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();

  const db = await scopedClient(auth);

  // Confirm the investor (lead) is in this tenant.
  const { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Investor");

  const { data, error } = await db
    .from("investor_commitments")
    .select("*, offerings!investor_commitments_offering_id_fkey(id, name, currency, status)")
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch commitments", 500);
  return apiSuccess(data ?? []);
}
