// GET /api/v1/inbox/conversations
// List conversations for the tenant, scoped to what the caller may see — see
// src/lib/inbox/scope.ts.

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isInboxScopeRestricted, resolveInboxLeadScope, visibleLeadIdsAmong } from "@/lib/inbox/scope";

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

  // Scoping: a restricted caller (counselor "own", or branch manager "team") is
  // narrowed to the leads their conversations actually reference — resolved from
  // that small set, never from every visible lead (Admizz has 16k+ leads; see
  // src/lib/leads/branch-membership.ts:56 for the URL-overflow failure mode this
  // avoids). Everyone else (owner/admin, or a leadScope:"all" position) is
  // unrestricted, same as before.
  const scope = resolveInboxLeadScope(auth);
  let visibleLeadIds: string[] | null = null;

  if (isInboxScopeRestricted(scope)) {
    let candidateQuery = supabase
      .from("conversations")
      .select("lead_id")
      .eq("tenant_id", auth.tenantId)
      .not("lead_id", "is", null);
    if (status !== "all") candidateQuery = candidateQuery.eq("status", status);
    if (channelId) candidateQuery = candidateQuery.eq("channel_id", channelId);
    if (assignee === "mine") candidateQuery = candidateQuery.eq("assigned_to_user_id", auth.userId);
    else if (assignee === "unassigned") candidateQuery = candidateQuery.eq("assignee_type", "unassigned");

    const { data: candidateRows } = await candidateQuery;
    const candidateLeadIds = Array.from(
      new Set((candidateRows ?? []).map((r: { lead_id: string }) => r.lead_id))
    );

    const userClient = await createClient();
    visibleLeadIds = await visibleLeadIdsAmong(
      { user: userClient, service: supabase },
      auth.tenantId,
      scope,
      candidateLeadIds
    );
    if (visibleLeadIds.length === 0) return apiSuccess([]);
  }

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
  if (visibleLeadIds !== null) {
    query = query.in("lead_id", visibleLeadIds);
  }

  const { data, error } = await query;

  if (error) {
    return apiSuccess([]);
  }

  return apiSuccess(data ?? []);
}
