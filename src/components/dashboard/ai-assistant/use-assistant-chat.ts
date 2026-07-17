"use client";

import { useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";

export interface AssistantMessageMetadata {
  conversationId?: string;
}

export type AssistantUIMessage = UIMessage<AssistantMessageMetadata>;

interface UseAssistantChatOptions {
  /** Chat/conversation id. A fresh UUID for a brand-new chat. */
  id: string;
  initialMessages?: AssistantUIMessage[];
  userFirstName?: string;
  /** Called once the server confirms (or, on a rare id collision, regenerates) the conversation id. */
  onConversationId?: (conversationId: string) => void;
}

/**
 * The server's flag-off / not-found responses share the same 404 shape
 * (`{ error: { code: "NOT_FOUND", ... } }`) — a brand-new chat's first send
 * has no legitimate 404 path other than the assistant being disabled.
 */
function isAssistantDisabledError(error: Error | undefined): boolean {
  if (!error) return false;
  try {
    const parsed = JSON.parse(error.message) as { error?: { code?: string } };
    return parsed?.error?.code === "NOT_FOUND";
  } catch {
    return false;
  }
}

/** Extracts a human-readable message from either a JSON API error body or a plain embedded stream-error string. */
export function friendlyErrorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Not JSON — the embedded stream-error case is already a plain sentence.
  }
  return error.message || "Something went wrong. Please try again.";
}

export function useAssistantChat({ id, initialMessages, userFirstName, onConversationId }: UseAssistantChatOptions) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUIMessage>({
        api: "/api/v1/ai/chat",
        body: userFirstName ? { name: userFirstName } : undefined,
      }),
    [userFirstName]
  );

  const chat = useChat<AssistantUIMessage>({
    id,
    messages: initialMessages,
    transport,
    // Read tools still execute fully server-side in one round trip — the ONLY
    // client round-trip this drives is a tool-approval decision: once the last
    // assistant message's approval requests are all responded to, resend
    // automatically so the approved tool's execute() actually runs.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message }) => {
      const conversationId = message.metadata?.conversationId;
      if (conversationId) onConversationId?.(conversationId);
    },
  });

  const disabled = isAssistantDisabledError(chat.error);

  const retry = useCallback(() => {
    chat.clearError();
    void chat.regenerate();
  }, [chat]);

  const send = useCallback(
    (text: string) => {
      void chat.sendMessage({ text });
    },
    [chat]
  );

  const approveTool = useCallback(
    (approvalId: string) => {
      void chat.addToolApprovalResponse({ id: approvalId, approved: true });
    },
    [chat]
  );

  const denyTool = useCallback(
    (approvalId: string) => {
      void chat.addToolApprovalResponse({ id: approvalId, approved: false });
    },
    [chat]
  );

  return { ...chat, disabled, retry, send, approveTool, denyTool };
}
