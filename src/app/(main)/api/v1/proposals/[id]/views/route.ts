import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROPOSALS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: proposal } = await db
    .from("proposals")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!proposal) return apiNotFound("Proposal");

  const [countRes, firstRes, lastRes] = await Promise.all([
    db.from("proposal_views").select("*", { count: "exact", head: true }).eq("proposal_id", id),
    db.from("proposal_views").select("viewed_at").eq("proposal_id", id).order("viewed_at", { ascending: true }).limit(1).maybeSingle(),
    db.from("proposal_views").select("viewed_at").eq("proposal_id", id).order("viewed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (countRes.error || firstRes.error || lastRes.error) {
    return apiError("DB_ERROR", "Failed to fetch proposal views", 500);
  }

  const first = firstRes.data as unknown as { viewed_at: string } | null;
  const last = lastRes.data as unknown as { viewed_at: string } | null;

  return apiSuccess({
    count: countRes.count ?? 0,
    first_viewed_at: first?.viewed_at ?? null,
    last_viewed_at: last?.viewed_at ?? null,
  });
}
