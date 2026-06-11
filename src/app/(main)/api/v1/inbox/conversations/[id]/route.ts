// GET /api/v1/inbox/conversations/[id]
// PATCH /api/v1/inbox/conversations/[id]  (status, assignee, stage_tag)

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiSuccess,
} from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("*, inbox_channels(id, provider, display_name, external_account_id), leads(id, first_name, last_name, email, phone)")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (error || !data) return apiNotFound("Conversation");

  const conv = data as Record<string, unknown>;

  // Counselor scoping
  if (auth.role === "counselor") {
    const leadId = conv.lead_id as string | null;
    if (!leadId) return apiForbidden();
    const { data: lead } = await supabase
      .from("leads")
      .select("assigned_to")
      .eq("id", leadId)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();
    if (!lead || (lead as { assigned_to: string | null }).assigned_to !== auth.userId) {
      return apiForbidden();
    }
  }

  return apiSuccess(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const allowed = ["status", "assignee_type", "assigned_to_user_id", "stage_tag", "ai_autonomy", "snoozed_until"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess({});
  }

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error || !data) return apiNotFound("Conversation");
  return apiSuccess(data);
}
