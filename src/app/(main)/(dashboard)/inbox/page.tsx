import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { InboxUI } from "@/components/dashboard/inbox/InboxUI";

export default async function InboxPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const supabase = await createServiceClient();

  // Parallel fetch: channels + first page of conversations + current user
  const [channelsResult, conversationsResult] = await Promise.all([
    supabase
      .from("inbox_channels")
      .select("id, provider, display_name, external_account_id, status")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("conversations")
      .select("*, inbox_channels(id, provider, display_name)")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("status", "open")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50),
  ]);

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
