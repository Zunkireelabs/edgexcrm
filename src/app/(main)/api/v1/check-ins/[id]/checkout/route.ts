import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/v1/check-ins/:id/checkout — stamp checked_out_at on a check-in note
export async function PATCH(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify note belongs to this tenant via its lead
  const { data: note } = await supabase
    .from("lead_notes")
    .select("id, leads!inner(tenant_id)")
    .eq("id", id)
    .like("content", "[CHECK-IN]%")
    .single();

  if (!note) return apiNotFound("Check-in record");

  const lead = note.leads as unknown as { tenant_id: string };
  if (lead.tenant_id !== auth.tenantId) return apiForbidden();

  const { error } = await supabase
    .from("lead_notes")
    .update({ checked_out_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return apiServiceUnavailable("Failed to record checkout");

  return apiSuccess({ checked_out: true, note_id: id });
}
