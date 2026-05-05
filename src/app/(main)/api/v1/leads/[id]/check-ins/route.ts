import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/:id/check-ins — get all check-in notes for a specific lead
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Fetch all check-in notes for this lead
  const { data, error } = await supabase
    .from("lead_notes")
    .select("id, content, created_at, user_email")
    .eq("lead_id", id)
    .like("content", "[CHECK-IN]%")
    .order("created_at", { ascending: false });

  if (error) {
    return apiServiceUnavailable("Failed to fetch check-in history");
  }

  return apiSuccess(data || []);
}
