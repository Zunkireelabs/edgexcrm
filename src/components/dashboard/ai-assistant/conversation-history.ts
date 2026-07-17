import type { AssistantUIMessage } from "./use-assistant-chat";

export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredMessageRow {
  id: string;
  role: "user" | "assistant" | "tool";
  content: unknown;
  created_at: string;
}

/**
 * Maps stored ai_messages rows back into UIMessages for a resumed conversation.
 * User rows store the full original UIMessage (see route.ts's onFinish); assistant
 * rows store `{ text, toolCalls }` — only `text` is rendered for history (no
 * historical tool-activity indicators, per brief).
 */
export function mapStoredMessagesToUIMessages(rows: StoredMessageRow[]): AssistantUIMessage[] {
  return rows
    .map((row): AssistantUIMessage | null => {
      if (row.role === "user") {
        const content = row.content as Partial<AssistantUIMessage> | null;
        if (content && Array.isArray(content.parts)) {
          return { id: row.id, role: "user", parts: content.parts };
        }
        return null;
      }
      if (row.role === "assistant") {
        const content = row.content as { text?: string } | null;
        return {
          id: row.id,
          role: "assistant",
          parts: [{ type: "text", text: content?.text ?? "" }],
        };
      }
      return null;
    })
    .filter((m): m is AssistantUIMessage => m !== null);
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/v1/ai/conversations");
  if (!res.ok) return [];
  const body = await res.json();
  return body.data?.conversations ?? [];
}

export async function fetchConversation(
  id: string
): Promise<{ conversation: ConversationSummary; messages: AssistantUIMessage[] } | null> {
  const res = await fetch(`/api/v1/ai/conversations/${id}`);
  if (!res.ok) return null;
  const body = await res.json();
  const conversation = body.data?.conversation as ConversationSummary | undefined;
  const rows = (body.data?.messages ?? []) as StoredMessageRow[];
  if (!conversation) return null;
  return { conversation, messages: mapStoredMessagesToUIMessages(rows) };
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await fetch(`/api/v1/ai/conversations/${id}`, { method: "DELETE" });
  return res.ok;
}
