import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { InboxUI } from "@/components/dashboard/inbox/InboxUI";
import { isInboxScopeRestricted, resolveInboxLeadScope, restrictedConversationFilter, visibleLeadIdsAmong } from "@/lib/inbox/scope";
import { canSeeNav } from "@/lib/api/permissions";

export default async function InboxPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const supabase = await createServiceClient();
  const tenantId = tenantData.tenant.id;

  const buildChannelsQuery = () =>
    supabase
      .from("inbox_channels")
      .select("id, provider, display_name, external_account_id, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

  const buildConversationsQuery = (restrictedFilter: string | null) => {
    let q = supabase
      .from("conversations")
      .select("*, inbox_channels(id, provider, display_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50);
    if (restrictedFilter !== null) q = q.or(restrictedFilter);
    return q;
  };

  // Scoping: same rule as the API route (src/lib/inbox/scope.ts) — a restricted
  // (own/branch) viewer is narrowed to the leads their open conversations actually
  // reference; everyone else (owner/admin, or a leadScope:"all" position) is
  // unrestricted, same as before.
  const scope = resolveInboxLeadScope({
    tenantId,
    userId: tenantData.userId,
    branchId: tenantData.branchId,
    permissions: tenantData.permissions,
  });

  let channelsResult: { data: unknown[] | null };
  let conversationsResult: { data: unknown[] | null };

  if (isInboxScopeRestricted(scope)) {
    const { data: candidateRows } = await supabase
      .from("conversations")
      .select("lead_id")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .not("lead_id", "is", null);
    const candidateLeadIds = Array.from(
      new Set((candidateRows ?? []).map((r: { lead_id: string }) => r.lead_id))
    );
    const userClient = await createClient();
    const visibleLeadIds = await visibleLeadIdsAmong(
      { user: userClient, service: supabase },
      tenantId,
      scope,
      candidateLeadIds
    );

    // Leads they can see, plus every website chat when they can open the Inbox (readable by all Inbox users).
    const filter = restrictedConversationFilter(visibleLeadIds, canSeeNav(tenantData.permissions, "/inbox"));

    channelsResult = await buildChannelsQuery();
    conversationsResult = filter === null ? { data: [] } : await buildConversationsQuery(filter);
  } else {
    // Parallel fetch: channels + first page of conversations
    [channelsResult, conversationsResult] = await Promise.all([
      buildChannelsQuery(),
      buildConversationsQuery(null),
    ]);
  }

  const channels = (channelsResult.data ?? []) as Array<{
    id: string;
    provider: string;
    display_name: string;
    external_account_id: string;
    status: string;
  }>;

  const conversations = (conversationsResult.data ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <InboxUI
        tenantId={tenantData.tenant.id}
        userId={tenantData.userId}
        userRole={tenantData.role}
        initialChannels={channels}
        initialConversations={conversations}
      />
    </div>
  );
}
