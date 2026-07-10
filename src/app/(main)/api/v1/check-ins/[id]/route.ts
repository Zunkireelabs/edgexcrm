import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/v1/check-ins/:id — set the per-visit "meet with" person on a check-in
// note. Distinct from the lead's assigned counselor (lead.assigned_to); editing
// this never touches the lead's assignment.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  let meetWithId: string | null = null;
  try {
    const body = await request.json();
    meetWithId = (body.meet_with_id as string) || null;
  } catch {
    return apiValidationError({ meet_with_id: ["Invalid request body"] });
  }

  const supabase = await createServiceClient();

  // Verify the note is a check-in belonging to this tenant (via its lead).
  const { data: note } = await supabase
    .from("lead_notes")
    .select("id, leads!inner(tenant_id)")
    .eq("id", id)
    .like("content", "[CHECK-IN]%")
    .single();

  if (!note) return apiNotFound("Check-in record");

  const lead = note.leads as unknown as { tenant_id: string };
  if (lead.tenant_id !== auth.tenantId) return apiForbidden();

  // If a person is provided, they must be a member of this tenant.
  if (meetWithId) {
    const { data: member } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", meetWithId)
      .single();
    if (!member) {
      return apiValidationError({ meet_with_id: ["Selected person is not a member of this tenant"] });
    }
  }

  const { error } = await supabase
    .from("lead_notes")
    .update({ meet_with_id: meetWithId })
    .eq("id", id);

  if (error) return apiServiceUnavailable("Failed to update meet-with");

  return apiSuccess({ note_id: id, meet_with_id: meetWithId });
}
