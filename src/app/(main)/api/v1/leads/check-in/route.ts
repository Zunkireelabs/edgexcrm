import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";

// GET /api/v1/leads/check-in?q=<email_or_phone>
// Live search for check-in: matches email or phone (partial, case-insensitive)
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return apiValidationError({ q: ["Query must be at least 3 characters"] });
  }

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("leads")
    .select(`
      id, first_name, last_name, email, phone, stage_id, pipeline_id, created_at,
      pipeline_stages(name, color),
      pipelines(name)
    `)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .or(`email.ilike.%${q}%,phone.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    return apiServiceUnavailable("Failed to search leads");
  }

  const results = (data || []).map((lead) => {
    const stage = lead.pipeline_stages as unknown as { name: string; color: string } | null;
    const pipeline = lead.pipelines as unknown as { name: string } | null;
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
      created_at: lead.created_at,
    };
  });

  return apiSuccess(results);
}
