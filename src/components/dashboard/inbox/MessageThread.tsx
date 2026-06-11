"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, CheckCheck, Clock, AlertCircle, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ConversationRow = Record<string, unknown>;
type MessageRow = Record<string, unknown>;

interface MessageThreadProps {
  conversation: ConversationRow;
  messages: MessageRow[];
  loading: boolean;
  currentUserId: string;
  userRole: string;
  onSend: (content: string, approveDraftId?: string) => Promise<void>;
  onApproveDraft: (draftId: string) => Promise<void>;
}

function statusIcon(status: string) {
  if (status === "sent" || status === "delivered" || status === "read") {
    return <CheckCheck className="w-3 h-3 text-blue-500" />;
  }
  if (status === "queued") return <Clock className="w-3 h-3 text-muted-foreground" />;
  if (status === "failed") return <AlertCircle className="w-3 h-3 text-destructive" />;
  return null;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageThread({
  conversation,
  messages,
  loading,
  currentUserId: _currentUserId,
  userRole: _userRole,
  onSend,
  onApproveDraft,
}: MessageThreadProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displayName = (conversation.contact_display_name as string | null)
    ?? (conversation.contact_phone as string | null)
    ?? "Unknown";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    try {
      await onSend(content);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="px-4 py-3 border-b flex items-center gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground">
            {conversation.provider as string} · {conversation.external_contact_id as string}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No messages yet
          </div>
        ) : (
          messages.map((msg) => {
            const id = msg.id as string;
            const direction = msg.direction as string;
            const authorType = msg.author_type as string;
            const content = msg.content_text as string | null;
            const status = msg.status as string;
            const ts = (msg.provider_timestamp ?? msg.created_at) as string;
            const isDraft = status === "draft";
            const isOutbound = direction === "outbound";
            const isAi = authorType === "ai_agent";

            return (
              <div
                key={id}
                className={cn(
                  "flex flex-col gap-0.5 max-w-[75%]",
                  isOutbound ? "self-end items-end" : "self-start items-start"
                )}
              >
                {isAi && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <Bot className="w-3 h-3" />
                    <span>AI suggested</span>
                  </div>
                )}
                <div
                  className={cn(
                    "px-3 py-2 rounded-2xl text-sm",
                    isOutbound
                      ? isDraft
                        ? "bg-amber-50 border border-amber-200 text-amber-900"
                        : "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {content ?? "—"}
                </div>
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-xs text-muted-foreground">{formatTime(ts)}</span>
                  {isOutbound && !isDraft && statusIcon(status)}
                  {isDraft && (
                    <button
                      onClick={() => onApproveDraft(id)}
                      className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 font-medium"
                      title="Approve draft"
                    >
                      <ThumbsUp className="w-3 h-3" />
                      Approve
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="px-4 py-3 border-t shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            className="resize-none min-h-[60px] max-h-[160px] text-sm"
            rows={2}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className="shrink-0 h-10 w-10"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
