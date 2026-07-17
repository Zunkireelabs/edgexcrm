"use client";

import { useState } from "react";
import { History, Plus, Trash2, Check, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchConversations, deleteConversation, type ConversationSummary } from "./conversation-history";

interface HistoryMenuProps {
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

export function HistoryMenu({ activeConversationId, onSelect, onNewChat }: HistoryMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function loadConversations() {
    setLoading(true);
    try {
      setConversations(await fetchConversations());
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await deleteConversation(id);
    if (ok) {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeConversationId) onNewChat();
    }
    setConfirmingId(null);
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadConversations();
        else setConfirmingId(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-white/60 text-gray-400 hover:text-gray-600 transition-colors"
          title="Chat history"
        >
          <History className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          onSelect={() => {
            onNewChat();
            setOpen(false);
          }}
          className="gap-2"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {loading && <DropdownMenuLabel className="text-xs text-gray-400 font-normal">Loading…</DropdownMenuLabel>}
        {!loading && conversations.length === 0 && (
          <DropdownMenuLabel className="text-xs text-gray-400 font-normal">No past chats yet</DropdownMenuLabel>
        )}
        {conversations.map((c) => (
          <div key={c.id} className="flex items-center gap-0.5 pl-1 pr-1">
            <button
              type="button"
              className={`flex-1 min-w-0 text-left text-sm truncate px-2 py-1.5 rounded-sm hover:bg-accent ${
                c.id === activeConversationId ? "font-medium" : "text-gray-700"
              }`}
              onClick={() => {
                onSelect(c.id);
                setOpen(false);
              }}
            >
              {c.title || "New chat"}
            </button>
            {confirmingId === c.id ? (
              <>
                <button
                  type="button"
                  className="p-1.5 text-red-500 hover:text-red-600"
                  title="Confirm delete"
                  onClick={() => void handleDelete(c.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="p-1.5 text-gray-400 hover:text-gray-600"
                  title="Cancel"
                  onClick={() => setConfirmingId(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="p-1.5 text-gray-300 hover:text-red-500"
                title="Delete chat"
                onClick={() => setConfirmingId(c.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
