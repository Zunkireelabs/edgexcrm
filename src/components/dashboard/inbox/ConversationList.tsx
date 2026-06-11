"use client";

import { useMemo } from "react";
import { MessageSquare, Phone, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ConversationRow = Record<string, unknown>;

interface Channel {
  id: string;
  provider: string;
  display_name: string;
  external_account_id: string;
  status: string;
}

interface ConversationListProps {
  conversations: ConversationRow[];
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filterStatus: "open" | "closed" | "all";
  filterAssignee: "all" | "mine" | "unassigned";
  filterChannel: string | "all";
  onFilterStatus: (v: "open" | "closed" | "all") => void;
  onFilterAssignee: (v: "all" | "mine" | "unassigned") => void;
  onFilterChannel: (v: string | "all") => void;
  currentUserId: string;
}

function providerLabel(provider: string) {
  const map: Record<string, string> = {
    sandbox: "Sandbox",
    whatsapp: "WhatsApp",
    messenger: "Messenger",
    instagram: "Instagram",
    email: "Email",
  };
  return map[provider] ?? provider;
}

function formatRelative(ts: string | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

export function ConversationList({
  conversations,
  channels,
  selectedId,
  onSelect,
  filterStatus,
  filterAssignee,
  filterChannel,
  onFilterStatus,
  onFilterAssignee,
  onFilterChannel,
  currentUserId: _currentUserId,
}: ConversationListProps) {
  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      if (filterChannel !== "all" && c.channel_id !== filterChannel) return false;
      return true;
    });
  }, [conversations, filterChannel]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Inbox</h2>
          {filtered.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs h-5 px-1.5">
              {filtered.length}
            </Badge>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-1 flex-wrap">
          {(["open", "closed", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onFilterStatus(s)}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full border transition-colors",
                filterStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex gap-1 mt-1 flex-wrap">
          {(["all", "mine", "unassigned"] as const).map((a) => (
            <button
              key={a}
              onClick={() => onFilterAssignee(a)}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full border transition-colors",
                filterAssignee === a
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              )}
            >
              {a === "all" ? "All" : a === "mine" ? "Mine" : "Unassigned"}
            </button>
          ))}
        </div>

        {channels.length > 1 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            <button
              onClick={() => onFilterChannel("all")}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full border transition-colors",
                filterChannel === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              )}
            >
              All channels
            </button>
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => onFilterChannel(ch.id)}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full border transition-colors",
                  filterChannel === ch.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                {ch.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-1 py-8">
            <MessageSquare className="w-6 h-6 opacity-30" />
            <p>No conversations</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const id = conv.id as string;
            const displayName = (conv.contact_display_name as string | null) || (conv.contact_phone as string | null) || "Unknown";
            const preview = conv.last_message_preview as string | null;
            const ts = conv.last_message_at as string | null;
            const unread = (conv.unread_count as number | null) ?? 0;
            const provider = conv.provider as string;
            const isLinked = !!conv.lead_id;

            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                className={cn(
                  "w-full text-left px-3 py-3 border-b hover:bg-muted/50 transition-colors flex gap-2",
                  selectedId === id && "bg-muted"
                )}
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-gray-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-medium truncate">{displayName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatRelative(ts)}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {preview ?? "No messages yet"}
                    </span>
                    {unread > 0 && (
                      <Badge className="text-xs h-4 px-1 shrink-0 bg-primary text-primary-foreground">
                        {unread}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-xs text-muted-foreground/70 bg-muted px-1 rounded">
                      {providerLabel(provider)}
                    </span>
                    {isLinked && (
                      <span title="Linked to lead">
                        <Phone className="w-3 h-3 text-green-600" />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
