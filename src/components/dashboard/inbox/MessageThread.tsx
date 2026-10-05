"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, CheckCheck, Clock, AlertCircle, ThumbsUp, Paperclip, Download, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ConversationRow = Record<string, unknown>;
type MessageRow = Record<string, unknown>;

interface Attachment {
  type: "image" | "document" | "audio" | "video" | "sticker";
  provider_media_id: string;
  bucket?: string;
  path?: string;
  filename: string | null;
  mime_type: string | null;
  size?: number;
  error?: string;
}

interface MessageThreadProps {
  conversation: ConversationRow;
  messages: MessageRow[];
  loading: boolean;
  currentUserId: string;
  userRole: string;
  onSend: (content: string, approveDraftId?: string, files?: File[]) => Promise<void>;
  onApproveDraft: (draftId: string) => Promise<void>;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Fetches a short-lived signed URL on demand — never embedded in the server-rendered
// thread payload, where it would leak into page source and outlive the view
// (docs/INBOX-ATTACHMENTS-BRIEF.md §3b).
function AttachmentView({ conversationId, messageId, attachment }: { conversationId: string; messageId: string; attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  if (attachment.error) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 rounded-lg px-2 py-1.5">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>Attachment failed to load{attachment.filename ? `: ${attachment.filename}` : ""}</span>
      </div>
    );
  }

  const fetchUrl = async (): Promise<string | null> => {
    if (url) return url;
    setLoadingUrl(true);
    try {
      const res = await fetch(
        `/api/v1/inbox/conversations/${conversationId}/attachments/signed-url?messageId=${messageId}&path=${encodeURIComponent(attachment.path ?? "")}`
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { data: { url: string } };
      setUrl(json.data.url);
      return json.data.url;
    } finally {
      setLoadingUrl(false);
    }
  };

  if (attachment.type === "image") {
    return (
      <button
        type="button"
        className="block rounded-lg overflow-hidden border max-w-[220px]"
        onClick={async () => {
          const u = await fetchUrl();
          if (u) window.open(u, "_blank", "noopener,noreferrer");
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={attachment.filename ?? "image"} className="block w-full h-auto" />
        ) : (
          <ImagePreviewLoader onVisible={fetchUrl} loading={loadingUrl} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs max-w-[220px] hover:bg-muted/50"
      onClick={async () => {
        const u = await fetchUrl();
        if (u) window.open(u, "_blank", "noopener,noreferrer");
      }}
    >
      <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-left">{attachment.filename ?? attachment.type}</span>
      <span className="text-muted-foreground shrink-0">{formatSize(attachment.size)}</span>
      {loadingUrl ? <Clock className="w-3 h-3 shrink-0 animate-pulse" /> : <Download className="w-3 h-3 shrink-0" />}
    </button>
  );
}

// Lazily resolves the signed URL for an image on first render (click-to-open still
// works before it resolves) so an inline preview doesn't need a manual click first.
function ImagePreviewLoader({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  useEffect(() => {
    onVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="w-full h-32 flex items-center justify-center bg-muted text-muted-foreground text-xs">
      {loading ? "Loading image…" : "Image"}
    </div>
  );
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationId = conversation.id as string;

  const displayName = (conversation.contact_display_name as string | null)
    ?? (conversation.contact_phone as string | null)
    ?? "Unknown";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = draft.trim();
    if ((!content && pendingFiles.length === 0) || sending) return;
    setSending(true);
    setDraft("");
    const files = pendingFiles;
    setPendingFiles([]);
    try {
      await onSend(content, undefined, files.length > 0 ? files : undefined);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
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
            const attachments = (msg.attachments ?? []) as Attachment[];
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
                {attachments.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {attachments.map((att, i) => (
                      <AttachmentView key={`${id}-att-${i}`} conversationId={conversationId} messageId={id} attachment={att} />
                    ))}
                  </div>
                )}
                {content && (
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
                    {content}
                  </div>
                )}
                {!content && attachments.length === 0 && (
                  <div
                    className={cn(
                      "px-3 py-2 rounded-2xl text-sm",
                      isOutbound ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    )}
                  >
                    —
                  </div>
                )}
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
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pendingFiles.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-1">
                <Paperclip className="w-3 h-3" />
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 h-10 w-10"
            title="Attach a file"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
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
            disabled={(!draft.trim() && pendingFiles.length === 0) || sending}
            className="shrink-0 h-10 w-10"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
