"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import { ContactPanel } from "./ContactPanel";
import { HandoverDialog, type HandoverMember } from "./HandoverDialog";
import { ownerOf, requiresClaim } from "@/lib/inbox/claim-rules";
import { mergeById, mergeUnion, useQuietPoll } from "@/lib/inbox/quiet-refresh";
import { toast } from "sonner";
import { ChatTextIcon } from "@/components/icons";

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
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationRow[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("conversation"));
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"open" | "closed" | "all">("open");
  const [filterAssignee, setFilterAssignee] = useState<"all" | "mine" | "unassigned">("all");
  const [filterChannel, setFilterChannel] = useState<string | "all">("all");
  // Website chats: who can be handed a chat (and a name for whoever is handling one), plus the hand-over window.
  const [members, setMembers] = useState<HandoverMember[]>([]);
  const [handoverOpen, setHandoverOpen] = useState(false);

  // Deep-link from a notification (/inbox?conversation=<id>): select the conversation.
  // Reacts to param changes even when already mounted on /inbox (router.push only swaps
  // the query string — no remount), then strips the param (matches the ?edit=1 pattern).
  const conversationParam = searchParams.get("conversation");
  useEffect(() => {
    if (conversationParam) {
      setSelectedId(conversationParam);
      router.replace(pathname);
    }
  }, [conversationParam, router, pathname]);

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;

  // The people who can open the Inbox. Used for the hand-over picker and to name whoever is handling a chat.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/inbox/handover-targets")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled && json?.data) setMembers(json.data as HandoverMember[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const ownerNames = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m.name])), [members]);
  const selectedOwnerId = (selectedConv?.assigned_to_user_id as string | null) ?? null;
  // On a website chat only the person handling it (or an admin) may change it. Everyone else reads.
  const canManageSelected =
    !selectedConv || !requiresClaim(selectedConv.provider as string | null)
      ? true
      : userRole === "owner" ||
        userRole === "admin" ||
        ownerOf({
          assignee_type: selectedConv.assignee_type as string | null,
          assigned_to_user_id: selectedConv.assigned_to_user_id as string | null,
        }) === userId;

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

  // Background refresh of the open chat: merges by id, never shows "Loading…", never replaces the list when nothing changed.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const refreshOpenChat = useCallback(async (convId: string) => {
    const res = await fetch(`/api/v1/inbox/conversations/${convId}/messages`);
    if (!res.ok) throw new Error("messages refresh failed");
    const json = await res.json() as { data: MessageRow[] };
    if (selectedIdRef.current !== convId) return; // the person moved to another chat meanwhile
    setMessages((prev) => mergeUnion(prev, json.data ?? []));
  }, []);

  useEffect(() => {
    // Always start a newly opened chat from an empty thread, so the quiet refresh can never mix two chats.
    setMessages([]);
    if (selectedId) fetchMessages(selectedId);
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
      setConversations((prev) => mergeById(prev, json.data ?? []));
    }
    return res.ok;
  }, [filterStatus, filterAssignee, filterChannel]);

  useEffect(() => {
    reloadConversations();
  }, [reloadConversations]);

  // Safety net under the live feed: every 12 s while the tab is visible, quietly bring the list and the open chat up to date.
  const quietSync = useQuietPoll(
    async () => {
      const listOk = await reloadConversations();
      const open = selectedIdRef.current;
      if (open) await refreshOpenChat(open);
      if (!listOk) throw new Error("conversations refresh failed");
    },
    12_000,
  );
  const quietSyncRef = useRef(quietSync);
  useEffect(() => {
    quietSyncRef.current = quietSync;
  }, [quietSync]);

  // Live realtime: any change to a message for this team means "look again". Same quiet path as the 12 s backup, so the
  // two can never disagree. A second look 1.5 s later covers the moment between the message arriving and the chat's
  // preview / owner being updated. The channel is made once per tenant (not once per opened chat), so no events fall in a gap.
  useEffect(() => {
    const supabase = createClient();
    let later: ReturnType<typeof setTimeout> | null = null;
    // A message for the open chat goes on screen straight from the event (this is what keeps long chats current: the
    // server only lists a chat's first 50 messages), then the quiet sync confirms it.
    const showNow = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as MessageRow;
      if (row?.conversation_id && row.conversation_id === selectedIdRef.current) {
        setMessages((prev) => mergeUnion(prev, [row]));
      }
    };
    const onEvent = (payload?: { new: Record<string, unknown> }) => {
      if (payload) showNow(payload);
      void quietSyncRef.current();
      if (later) clearTimeout(later);
      later = setTimeout(() => void quietSyncRef.current(), 1500);
    };

    const channel = supabase
      .channel(`inbox-messages-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` },
        onEvent,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` },
        onEvent,
      )
      .subscribe();

    return () => {
      if (later) clearTimeout(later);
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  const handleSend = async (content: string, approveDraftId?: string, files?: File[]) => {
    if (!selectedId) return;

    // The provider only lets ONE attachment ride a single message, so multiple picked
    // files become multiple sequential sends — the caption/content text rides with the
    // FIRST file only (or alone, if there's no file at all).
    if (files && files.length > 0) {
      let ok = true;
      for (let i = 0; i < files.length; i++) {
        const form = new FormData();
        if (i === 0 && content) form.append("content", content);
        form.append("file", files[i]);
        const res = await fetch(`/api/v1/inbox/conversations/${selectedId}/messages`, { method: "POST", body: form });
        if (!res.ok) ok = false;
      }
      if (ok) void quietSync();
      return;
    }

    const body: Record<string, string> = { content };
    if (approveDraftId) body.approve_draft_id = approveDraftId;
    const res = await fetch(`/api/v1/inbox/conversations/${selectedId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      // Show it right away (the live feed would also add it, but must not be the only way)
      void quietSync();
    }
  };

  const apiMessage = async (res: Response, fallback: string): Promise<string> => {
    const json = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return json?.error?.message ?? fallback;
  };

  // "Accept this chat": the first person wins. If someone was faster, say who.
  const handleAccept = async () => {
    if (!selectedId) return;
    const res = await fetch(`/api/v1/inbox/conversations/${selectedId}/claim`, { method: "POST" });
    if (res.ok) toast.success("You're handling this chat");
    else toast.error(await apiMessage(res, "Couldn't accept this chat"));
    await reloadConversations();
    await refreshOpenChat(selectedId).catch(() => {});
  };

  const moveChat = async (toUserId: string, success: string): Promise<boolean> => {
    if (!selectedId) return false;
    const res = await fetch(`/api/v1/inbox/conversations/${selectedId}/handover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_user_id: toUserId }),
    });
    if (res.ok) toast.success(success);
    else toast.error(await apiMessage(res, "Couldn't move this chat"));
    await reloadConversations();
    await refreshOpenChat(selectedId).catch(() => {});
    return res.ok;
  };

  // An owner/admin takes a chat over without waiting for a hand-over.
  const handleTakeOver = async () => { await moveChat(userId, "You took over this chat"); };

  const handleHandover = async (toUserId: string) => {
    const name = ownerNames[toUserId] ?? "your teammate";
    if (await moveChat(toUserId, `Chat handed to ${name}`)) setHandoverOpen(false);
  };

  const handleApproveDraft = async (draftId: string) => {
    if (!selectedId) return;
    await fetch(`/api/v1/inbox/conversations/${selectedId}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_message_id: draftId }),
    });
    await refreshOpenChat(selectedId).catch(() => {});
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
          ownerNames={ownerNames}
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
            ownerName={selectedOwnerId ? ownerNames[selectedOwnerId] ?? null : null}
            onAccept={handleAccept}
            onTakeOver={handleTakeOver}
            onHandover={() => setHandoverOpen(true)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <ChatTextIcon className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a conversation to start messaging</p>
          </div>
        )}
      </div>

      {/* Right pane: contact / lead profile */}
      <div className="w-72 shrink-0">
        <ContactPanel
          conversation={selectedConv}
          tenantId={tenantId}
          userRole={userRole}
          onConversationUpdate={reloadConversations}
          ownerName={selectedOwnerId ? ownerNames[selectedOwnerId] ?? null : null}
          canManage={canManageSelected}
        />
      </div>

      <HandoverDialog
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
        members={members}
        currentUserId={userId}
        contactName={
          ((selectedConv?.contact_display_name as string | null) ||
            (selectedConv?.contact_phone as string | null) ||
            "this visitor")
        }
        onConfirm={handleHandover}
      />
    </div>
  );
}
