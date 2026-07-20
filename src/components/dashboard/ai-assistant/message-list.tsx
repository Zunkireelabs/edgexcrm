"use client";

import type { ChatStatus } from "ai";
import { ChatMessage } from "./chat-message";
import { TypingIndicator } from "./typing-indicator";
import { ErrorBubble } from "./error-bubble";
import { friendlyErrorMessage, type AssistantUIMessage } from "./use-assistant-chat";

interface MessageListProps {
  messages: AssistantUIMessage[];
  status: ChatStatus;
  error?: Error;
  onRetry: () => void;
  onApproveTool?: (approvalId: string) => void;
  onDenyTool?: (approvalId: string) => void;
}

/** Shared message-list rendering — used by both the dashboard panel and the Ask Orca page. */
export function MessageList({ messages, status, error, onRetry, onApproveTool, onDenyTool }: MessageListProps) {
  return (
    <>
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />
      ))}
      {status === "submitted" && <TypingIndicator />}
      {status === "error" && error && <ErrorBubble message={friendlyErrorMessage(error)} onRetry={onRetry} />}
    </>
  );
}
