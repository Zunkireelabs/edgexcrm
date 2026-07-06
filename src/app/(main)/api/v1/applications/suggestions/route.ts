import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data } = await db
    .from("applications")
    .select("university_name, program_name")
    .is("deleted_at", null)
    .order("university_name", { ascending: true })
    .limit(1000);

  const rows = (data ?? []) as unknown as { university_name: string; program_name: string }[];
  const universities = [...new Set(rows.map((r) => r.university_name).filter(Boolean))].sort();
  const programs = [...new Set(rows.map((r) => r.program_name).filter(Boolean))].sort();

  return apiSuccess({ universities, programs });
}
