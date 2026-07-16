"use client";

import { Bot, User, Loader2, Check, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isToolUIPart, isTextUIPart, getToolName, type ToolUIPart, type DynamicToolUIPart, type UITools } from "ai";
import type { AssistantUIMessage } from "./use-assistant-chat";
import { toolActivityLabel } from "./tool-labels";

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

interface ChatMessageProps {
  message: AssistantUIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const textParts = message.parts.filter(isTextUIPart);
  const toolParts = message.parts.filter(isToolUIPart);
  const text = textParts.map((p) => p.text).join("");
  const hasText = text.trim().length > 0;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? "bg-blue-600" : "bg-gradient-to-br from-purple-500 to-pink-500"
        }`}
      >
        {isUser ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
      </div>

      <div className={`max-w-[80%] flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
        {toolParts.length > 0 && (
          <div className="flex flex-col gap-1">
            {toolParts.map((part) => (
              <ToolActivityLine key={part.toolCallId} part={part} />
            ))}
          </div>
        )}

        {hasText && (
          <div
            className={`rounded-2xl px-4 py-2.5 ${
              isUser ? "bg-blue-600 text-white rounded-br-md" : "bg-gray-100 text-gray-900 rounded-bl-md"
            }`}
          >
            {isUser ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
            ) : (
              <div className="text-sm leading-relaxed [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline [&_a]:break-all [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-gray-200 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolActivityLine({ part }: { part: AnyToolPart }) {
  const label = toolActivityLabel(getToolName(part));

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-500 px-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{label}…</span>
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-500 px-1">
        <AlertTriangle className="w-3 h-3" />
        <span>{label} failed</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400 px-1">
      <Check className="w-3 h-3" />
      <span>{label}</span>
    </div>
  );
}
