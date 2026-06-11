"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import { ContactPanel } from "./ContactPanel";
import { MessageSquare } from "lucide-react";

interface Channel {
  id: string;
  provider: string;
  display_name: string;
  external_account_id: string;
  status: string;
}

type ConversationRow = Record<string, unknown>;
type MessageRow = Record<string, unknown>;

interface InboxUIProps {
  tenantId: string;
  userId: string;
  userRole: string;
  initialChannels: Channel[];
  initialConversations: ConversationRow[];
}

export function InboxUI({
  tenantId,
  userId,
  userRole,
  initialChannels,
  initialConversations,
}: InboxUIProps) {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("conversation"));
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"open" | "closed" | "all">("open");
  const [filterAssignee, setFilterAssignee] = useState<"all" | "mine" | "unassigned">("all");
  const [filterChannel, setFilterChannel] = useState<string | "all">("all");

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${convId}/messages`);
      if (res.ok) {
        const json = await res.json() as { data: MessageRow[] };
        setMessages(json.data ?? []);
      }
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchMessages(selectedId);
    } else {
      setMessages([]);
    }
  }, [selectedId, fetchMessages]);

  // Reload conversation list when filters change
  const reloadConversations = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filterStatus !== "all") qs.set("status", filterStatus);
    if (filterAssignee !== "all") qs.set("assignee", filterAssignee);
    if (filterChannel !== "all") qs.set("channel_id", filterChannel);
    qs.set("limit", "50");
    const res = await fetch(`/api/v1/inbox/conversations?${qs}`);
    if (res.ok) {
      const json = await res.json() as { data: ConversationRow[] };
      setConversations(json.data ?? []);
    }
  }, [filterStatus, filterAssignee, filterChannel]);

  useEffect(() => {
    reloadConversations();
  }, [reloadConversations]);

  // Live realtime: subscribe to messages table filtered by tenant_id
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`inbox-messages-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const newMsg = payload.new as MessageRow;
          // If the new message belongs to the open conversation, append it
          if (selectedId && newMsg.conversation_id === selectedId) {
            setMessages((prev) => {
              // Avoid duplicates
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
          // Refresh conversation list to update last_message_preview + unread_count
          reloadConversations();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const updated = payload.new as MessageRow;
          if (selectedId && updated.conversation_id === selectedId) {
            setMessages((prev) =>
              prev.map((m) => (m.id === updated.id ? updated : m))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, selectedId, reloadConversations]);

  const handleSend = async (content: string, approveDraftId?: string) => {
    if (!selectedId) return;
    const body: Record<string, string> = { content };
    if (approveDraftId) body.approve_draft_id = approveDraftId;
    const res = await fetch(`/api/v1/inbox/conversations/${selectedId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      // Realtime will add the message; just refresh the list
      reloadConversations();
    }
  };

  const handleApproveDraft = async (draftId: string) => {
    if (!selectedId) return;
    await fetch(`/api/v1/inbox/conversations/${selectedId}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_message_id: draftId }),
    });
    if (selectedId) fetchMessages(selectedId);
    reloadConversations();
  };

  return (
    <div className="flex h-full overflow-hidden border rounded-lg bg-white">
      {/* Left pane: conversation list */}
      <div className="w-80 shrink-0 border-r flex flex-col">
        <ConversationList
          conversations={conversations}
          channels={initialChannels}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filterStatus={filterStatus}
          filterAssignee={filterAssignee}
          filterChannel={filterChannel}
          onFilterStatus={setFilterStatus}
          onFilterAssignee={setFilterAssignee}
          onFilterChannel={setFilterChannel}
          currentUserId={userId}
        />
      </div>

      {/* Middle pane: thread + composer */}
      <div className="flex-1 flex flex-col min-w-0 border-r">
        {selectedConv ? (
          <MessageThread
            conversation={selectedConv}
            messages={messages}
            loading={loadingMessages}
            currentUserId={userId}
            userRole={userRole}
            onSend={handleSend}
            onApproveDraft={handleApproveDraft}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <MessageSquare className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a conversation to start messaging</p>
          </div>
        )}
      </div>

      {/* Right pane: contact / lead profile */}
      <div className="w-72 shrink-0">
        <ContactPanel
          conversation={selectedConv}
          tenantId={tenantId}
          onConversationUpdate={reloadConversations}
        />
      </div>
    </div>
  );
}
