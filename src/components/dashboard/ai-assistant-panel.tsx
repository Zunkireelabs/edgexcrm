"use client";

import { useState, useEffect, useRef } from "react";
import { X, Sparkles, Maximize2, Minimize2 } from "lucide-react";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { ChatMessage } from "./ai-assistant/chat-message";
import { ChatInput } from "./ai-assistant/chat-input";
import { TypingIndicator } from "./ai-assistant/typing-indicator";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm your AI assistant. I can help you with:\n\n• Finding and managing leads\n• Understanding your pipeline\n• Answering questions about your CRM\n\nHow can I help you today?",
  timestamp: new Date(),
};

export function AIAssistantPanel() {
  const { isOpen, closeAssistant } = useAIAssistant();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [isTyping, setIsTyping] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closeAssistant();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeAssistant]);

  const handleSend = async (content: string) => {
    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const response = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response || "I'm sorry, I couldn't process that request.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const panelWidth = isExpanded ? "w-[600px]" : "w-[420px]";

  return (
    <div
      className={`h-full transition-all duration-500 ease-out overflow-hidden ${
        isOpen ? `${panelWidth} opacity-100` : "w-0 opacity-0"
      }`}
    >
      <div
        className={`h-full transition-transform duration-500 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-8"
        }`}
      >
        <div
          className="h-full bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden shadow-sm"
          style={{ width: isExpanded ? 600 : 420 }}
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
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 rounded-md hover:bg-white/60 text-gray-400 hover:text-gray-600 transition-colors"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={closeAssistant}
                className="p-1.5 rounded-md hover:bg-white/60 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
              />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <ChatInput onSend={handleSend} disabled={isTyping} />

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
