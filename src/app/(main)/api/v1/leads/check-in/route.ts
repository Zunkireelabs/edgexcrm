import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { getTeamMembers } from "@/lib/supabase/queries";

// GET /api/v1/leads/check-in?q=<email_or_phone>
// Live search for check-in: matches email or phone (partial, case-insensitive)
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return apiValidationError({ q: ["Query must be at least 3 characters"] });
  }

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("leads")
    .select(`
      id, first_name, last_name, email, phone, stage_id, pipeline_id, created_at,
      list_id, assigned_to,
      pipeline_stages(name, color),
      pipelines(name),
      lead_lists(name)
    `)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .or(`email.ilike.%${q}%,phone.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    return apiServiceUnavailable("Failed to search leads");
  }

  const leads = data || [];

  // Resolve assigned_to → display name server-side (mirrors check-ins/route.ts ~L131-141).
  const needsNames = leads.some((lead) => lead.assigned_to);
  const nameById = new Map<string, string>();
  if (needsNames) {
    const team = await getTeamMembers(auth.tenantId);
    for (const m of team) nameById.set(m.user_id, m.name);
  }

  const results = leads.map((lead) => {
    const stage = lead.pipeline_stages as unknown as { name: string; color: string } | null;
    const pipeline = lead.pipelines as unknown as { name: string } | null;
    const list = lead.lead_lists as unknown as { name: string } | null;
    return {
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      stage_id: lead.stage_id,
      pipeline_id: lead.pipeline_id,
      stage_name: stage?.name || null,
      stage_color: stage?.color || null,
      pipeline_name: pipeline?.name || null,
      list_name: list?.name || null,
      assigned_to_name: lead.assigned_to ? nameById.get(lead.assigned_to) ?? null : null,
      created_at: lead.created_at,
    };
  });

  return apiSuccess(results);
}
