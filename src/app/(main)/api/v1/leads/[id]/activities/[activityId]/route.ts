import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiForbidden,
} from "@/lib/api/response";

// DELETE /api/v1/leads/[id]/activities/[activityId] - Delete an activity
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const { id: leadId, activityId } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (leadError || !lead) {
    return apiNotFound("Lead");
  }

  // Get the activity first to check ownership
  const { data: activity, error: activityError } = await supabase
    .from("lead_activities")
    .select("id, user_id")
    .eq("id", activityId)
    .eq("lead_id", leadId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (activityError || !activity) {
    return apiNotFound("Activity");
  }

  // Only allow delete if user is admin or the creator
  const isAdmin = auth.role === "owner" || auth.role === "admin";
  const isCreator = activity.user_id === auth.userId;

  if (!isAdmin && !isCreator) {
    return apiForbidden();
  }

  // Delete the activity
  const { error: deleteError } = await supabase
    .from("lead_activities")
    .delete()
    .eq("id", activityId);

  if (deleteError) {
    console.error("Error deleting activity:", deleteError);
    return apiNotFound("Activity");
  }

  return apiSuccess({ deleted: true });
}
