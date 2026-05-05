import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiServiceUnavailable,
} from "@/lib/api/response";

// GET /api/v1/check-ins?from=<ISO>&to=<ISO>
// Returns check-in notes with lead info, filtered by date range
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = await createServiceClient();

  // Query lead_notes that start with [CHECK-IN], joined with lead info
  let query = supabase
    .from("lead_notes")
    .select(`
      id, content, created_at, user_email,
      leads!inner(id, first_name, last_name, email, phone, tenant_id, deleted_at,
        pipeline_stages(name, color),
        pipelines(name)
      )
    `)
    .like("content", "[CHECK-IN]%")
    .eq("leads.tenant_id", auth.tenantId)
    .is("leads.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (from) {
    query = query.gte("created_at", from);
  }
  if (to) {
    // Add end of day to "to" date
    const toDate = to.includes("T") ? to : `${to}T23:59:59.999Z`;
    query = query.lte("created_at", toDate);
  }

  const { data, error } = await query;

  if (error) {
    return apiServiceUnavailable("Failed to fetch check-ins");
  }

  const checkIns = (data || []).map((note) => {
    const lead = note.leads as unknown as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      pipeline_stages: { name: string; color: string } | null;
      pipelines: { name: string } | null;
    };
    return {
      id: note.id,
      lead_id: lead?.id || null,
      first_name: lead?.first_name || null,
      last_name: lead?.last_name || null,
      email: lead?.email || null,
      phone: lead?.phone || null,
      stage_name: lead?.pipeline_stages?.name || null,
      stage_color: lead?.pipeline_stages?.color || null,
      pipeline_name: lead?.pipelines?.name || null,
      checked_in_at: note.created_at,
      checked_in_by: note.user_email,
      note: note.content,
    };
  });

  return apiSuccess(checkIns);
}
