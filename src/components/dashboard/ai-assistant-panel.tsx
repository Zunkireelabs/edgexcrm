"use client";

import { useState, useEffect, useRef } from "react";
import { X, Sparkles, Maximize2, Minimize2 } from "lucide-react";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { ChatInput } from "./ai-assistant/chat-input";
import { MessageList } from "./ai-assistant/message-list";
import { HistoryMenu } from "./ai-assistant/history-menu";
import { AssistantDisabled } from "./ai-assistant/assistant-disabled";
import { useAssistantChat, type AssistantUIMessage } from "./ai-assistant/use-assistant-chat";
import { fetchConversation } from "./ai-assistant/conversation-history";

const WELCOME_CONTENT =
  "Hi! I'm your AI assistant. I can help you with:\n\n• Finding and managing leads\n• Understanding your pipeline\n• Answering questions about your CRM\n\nHow can I help you today?";

interface AIAssistantPanelProps {
  userFirstName?: string;
}

export function AIAssistantPanel({ userFirstName }: AIAssistantPanelProps) {
  const { isOpen, closeAssistant } = useAIAssistant();
  const [isExpanded, setIsExpanded] = useState(false);
  // Lazy initializer — the id itself is never rendered, so an SSR/client
  // mismatch in its VALUE doesn't cause a hydration error.
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [initialMessages, setInitialMessages] = useState<AssistantUIMessage[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) closeAssistant();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeAssistant]);

  function startNewChat() {
    setInitialMessages([]);
    setConversationId(crypto.randomUUID());
  }

  async function selectConversation(id: string) {
    const result = await fetchConversation(id);
    if (!result) return;
    setInitialMessages(result.messages);
    setConversationId(result.conversation.id);
  }

  const panelWidth = isExpanded ? 600 : 420;

  return (
    <div
      className={`h-full transition-all duration-500 ease-out overflow-hidden ${
        isOpen ? "opacity-100" : "w-0 opacity-0"
      }`}
      style={{ width: isOpen ? panelWidth : 0 }}
    >
      <div
        className={`h-full transition-transform duration-500 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-8"
        }`}
      >
        <div
          className="h-full bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden shadow-sm"
          style={{ width: panelWidth }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">AI Assistant</h2>
                <p className="text-[10px] text-gray-500">Powered by Zunkiree AI</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <HistoryMenu activeConversationId={conversationId} onSelect={selectConversation} onNewChat={startNewChat} />
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 rounded-md hover:bg-white/60 text-gray-400 hover:text-gray-600 transition-colors"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={closeAssistant}
                className="p-1.5 rounded-md hover:bg-white/60 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <AssistantPanelThread
            key={conversationId}
            conversationId={conversationId}
            initialMessages={initialMessages}
            userFirstName={userFirstName}
            onConversationId={setConversationId}
          />

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
            <p className="text-[10px] text-gray-400 text-center">
              AI-generated content may be inaccurate. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AssistantPanelThreadProps {
  conversationId: string;
  initialMessages: AssistantUIMessage[];
  userFirstName?: string;
  onConversationId: (id: string) => void;
}

function AssistantPanelThread({ conversationId, initialMessages, userFirstName, onConversationId }: AssistantPanelThreadProps) {
  const { messages, status, error, disabled, hasPendingApproval, retry, send, approveTool, denyTool } = useAssistantChat({
    id: conversationId,
    initialMessages,
    userFirstName,
    onConversationId,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  if (disabled) {
    return <AssistantDisabled />;
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
        {messages.length === 0 && (
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-gray-100 text-gray-900 px-4 py-2.5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{WELCOME_CONTENT}</p>
            </div>
          </div>
        )}
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
      <ChatInput
        onSend={send}
        disabled={status === "submitted" || status === "streaming" || hasPendingApproval}
        disabledHint={hasPendingApproval ? "Approve or deny the pending action to continue" : undefined}
      />
    </>
  );
}
