import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiNotFound,
} from "@/lib/api/response";
import type { ActivityType, CallOutcome, LeadActivityRecord } from "@/types/database";

const VALID_ACTIVITY_TYPES: ActivityType[] = ["call", "email", "meeting"];
const VALID_CALL_OUTCOMES: CallOutcome[] = ["connected", "left_voicemail", "no_answer", "busy", "wrong_number"];

// GET /api/v1/leads/[id]/activities - List activities for a lead
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params;

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

  // Get query params for filtering
  const searchParams = request.nextUrl.searchParams;
  const activityType = searchParams.get("type") as ActivityType | null;

  // Build query
  let query = supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });

  if (activityType && VALID_ACTIVITY_TYPES.includes(activityType)) {
    query = query.eq("activity_type", activityType);
  }

  const { data: activities, error } = await query;

  if (error) {
    console.error("Error fetching activities:", error);
    return apiNotFound("Activities");
  }

  // Get user emails for activities
  const userIds = [...new Set((activities || []).map(a => a.user_id))];
  const { data: users } = await supabase
    .from("tenant_users")
    .select("user_id, email")
    .eq("tenant_id", auth.tenantId)
    .in("user_id", userIds);

  const userEmailMap = new Map(users?.map(u => [u.user_id, u.email]) || []);

  // Add user email to each activity
  const activitiesWithEmail = (activities || []).map(a => ({
    ...a,
    user_email: userEmailMap.get(a.user_id) || null,
  }));

  return apiSuccess(activitiesWithEmail as LeadActivityRecord[]);
}

// POST /api/v1/leads/[id]/activities - Log a new activity
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { activity_type, subject, description, call_outcome, duration_minutes, scheduled_at, location, attendees, email_subject, email_body } = body;

  // Validate activity_type
  if (!activity_type || !VALID_ACTIVITY_TYPES.includes(activity_type as ActivityType)) {
    return apiValidationError({ activity_type: ["Must be one of: call, email, meeting"] });
  }

  // Validate call_outcome if provided
  if (call_outcome && !VALID_CALL_OUTCOMES.includes(call_outcome as CallOutcome)) {
    return apiValidationError({ call_outcome: ["Invalid call outcome"] });
  }

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

  // Create the activity
  const { data: activity, error } = await supabase
    .from("lead_activities")
    .insert({
      lead_id: leadId,
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      activity_type: activity_type as ActivityType,
      subject: subject as string || null,
      description: description as string || null,
      call_outcome: call_outcome as CallOutcome || null,
      duration_minutes: typeof duration_minutes === "number" ? duration_minutes : null,
      scheduled_at: scheduled_at as string || null,
      location: location as string || null,
      attendees: Array.isArray(attendees) ? attendees : null,
      email_subject: email_subject as string || null,
      email_body: email_body as string || null,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating activity:", error);
    return apiValidationError({ activity: ["Failed to create activity"] });
  }

  // Get user email
  const { data: user } = await supabase
    .from("tenant_users")
    .select("email")
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId)
    .single();

  return apiSuccess({
    ...activity,
    user_email: user?.email || null,
  } as LeadActivityRecord, 201);
}
