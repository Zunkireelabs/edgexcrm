"use client";

import { useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/dashboard/ai-assistant/chat-input";
import { MessageList } from "@/components/dashboard/ai-assistant/message-list";
import { AssistantDisabled } from "@/components/dashboard/ai-assistant/assistant-disabled";
import { useAssistantChat } from "@/components/dashboard/ai-assistant/use-assistant-chat";

const SUGGESTIONS = ["Summarize my pipeline", "What are my open tasks?", "Search my leads", "Show recent activity"];

interface AskOrcaContentProps {
  userFirstName?: string;
}

export function AskOrcaContent({ userFirstName }: AskOrcaContentProps) {
  // Lazy initializer — the id itself is never rendered, so an SSR/client
  // mismatch in its VALUE doesn't cause a hydration error.
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());

  return (
    <AskOrcaThread
      key={conversationId}
      conversationId={conversationId}
      userFirstName={userFirstName}
      onConversationId={setConversationId}
    />
  );
}

interface AskOrcaThreadProps {
  conversationId: string;
  userFirstName?: string;
  onConversationId: (id: string) => void;
}

function AskOrcaThread({ conversationId, userFirstName, onConversationId }: AskOrcaThreadProps) {
  const { messages, status, error, disabled, hasPendingApproval, retry, send, approveTool, denyTool } = useAssistantChat({
    id: conversationId,
    userFirstName,
    onConversationId,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  if (disabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <AssistantDisabled />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-full max-w-2xl">
          <h1 className="text-3xl font-semibold text-foreground text-center mb-8 tracking-[-0.025em]">
            What can I do for you?
          </h1>

          <div className="rounded-2xl border border-border shadow-sm overflow-hidden bg-card">
            <ChatInput onSend={send} placeholder="Ask anything or start a task..." />
          </div>

          <div className="mt-4">
            <p className="text-xs text-muted-foreground text-center mb-3">Try asking Orca:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-full text-[12px] font-medium text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto space-y-4 py-4">
        <MessageList
          messages={messages}
          status={status}
          error={error}
          onRetry={retry}
          onApproveTool={approveTool}
          onDenyTool={denyTool}
        />
        <div ref={messagesEndRef} />
      </div>
      <div className="rounded-2xl border border-border shadow-sm overflow-hidden bg-card">
        <ChatInput
          onSend={send}
          disabled={status === "submitted" || status === "streaming" || hasPendingApproval}
          disabledHint={hasPendingApproval ? "Approve or deny the pending action to continue" : undefined}
          placeholder="Ask anything or start a task..."
        />
      </div>
    </div>
  );
}
