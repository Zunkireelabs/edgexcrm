// GET /api/v1/inbox/conversations
// List conversations for the tenant. Counselor scoping: only convs linked to their leads.

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();
  const { searchParams } = new URL(request.url);

  const status = searchParams.get("status") ?? "open";
  const channelId = searchParams.get("channel_id");
  const assignee = searchParams.get("assignee"); // "mine" | "unassigned"
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  let query = supabase
    .from("conversations")
    .select("*, inbox_channels(id, provider, display_name, external_account_id)")
    .eq("tenant_id", auth.tenantId)
    .order("last_message_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (channelId) {
    query = query.eq("channel_id", channelId);
  }
  if (assignee === "mine") {
    query = query.eq("assigned_to_user_id", auth.userId);
  } else if (assignee === "unassigned") {
    query = query.eq("assignee_type", "unassigned");
  }

  // Counselor scoping: only conversations linked to their assigned leads
  if (auth.role === "counselor") {
    const { data: myLeads } = await supabase
      .from("leads")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("assigned_to", auth.userId)
      .is("deleted_at", null);

    const myLeadIds = (myLeads ?? []).map((l: { id: string }) => l.id);
    if (myLeadIds.length === 0) {
      return apiSuccess([]);
    }
    query = query.in("lead_id", myLeadIds);
  }

  const { data, error } = await query;

  if (error) {
    return apiSuccess([]);
  }

  return apiSuccess(data ?? []);
}
