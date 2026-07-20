"use client";

import { Bot, User, Loader2, Check, AlertTriangle, FileText, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isToolUIPart, isTextUIPart, getToolName, type ToolUIPart, type DynamicToolUIPart, type UITools } from "ai";
import type { AssistantUIMessage } from "./use-assistant-chat";
import { toolActivityLabel } from "./tool-labels";
import { ApprovalCard, type ApprovalToolPart } from "./approval-card";

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

function isApprovalToolPart(part: AnyToolPart): part is ApprovalToolPart {
  return part.state === "approval-requested" || part.state === "approval-responded";
}

interface KnowledgeCitation {
  title: string;
  kbItemId: string;
  knowledgeBaseId: string;
  page?: number;
  section?: string;
}

// search_knowledge's tool output carries a `citation` payload per excerpt
// result (src/lib/ai/tools/universal/search-knowledge.ts) — parsed
// defensively since it's untrusted-shape data crossing the model boundary,
// not a typed contract between this component and the tool.
function extractCitations(output: unknown): KnowledgeCitation[] {
  if (!output || typeof output !== "object") return [];
  const results = (output as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const citations: KnowledgeCitation[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const citation = (result as { citation?: unknown }).citation;
    if (!citation || typeof citation !== "object") continue;
    const c = citation as Record<string, unknown>;
    if (typeof c.title !== "string" || typeof c.kbItemId !== "string" || typeof c.knowledgeBaseId !== "string") continue;

    const key = `${c.kbItemId}:${typeof c.page === "number" ? c.page : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    citations.push({
      title: c.title,
      kbItemId: c.kbItemId,
      knowledgeBaseId: c.knowledgeBaseId,
      ...(typeof c.page === "number" ? { page: c.page } : {}),
      ...(typeof c.section === "string" ? { section: c.section } : {}),
    });
  }
  return citations;
}

interface ChatMessageProps {
  message: AssistantUIMessage;
  onApproveTool?: (approvalId: string) => void;
  onDenyTool?: (approvalId: string) => void;
}

export function ChatMessage({ message, onApproveTool, onDenyTool }: ChatMessageProps) {
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
            {toolParts.map((part) =>
              isApprovalToolPart(part) ? (
                <ApprovalCard
                  key={part.toolCallId}
                  part={part}
                  onApprove={(id) => onApproveTool?.(id)}
                  onDeny={(id) => onDenyTool?.(id)}
                />
              ) : (
                <ToolActivityLine key={part.toolCallId} part={part} />
              ),
            )}
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

  if (part.state === "output-denied") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 px-1">
        <X className="w-3 h-3" />
        <span>{label} — denied</span>
      </div>
    );
  }

  const citations =
    part.state === "output-available" && getToolName(part) === "search_knowledge"
      ? extractCitations(part.output)
      : [];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 px-1">
        <Check className="w-3 h-3" />
        <span>{label}</span>
      </div>
      {citations.length > 0 && <CitationChips citations={citations} />}
    </div>
  );
}

function CitationChips({ citations }: { citations: KnowledgeCitation[] }) {
  return (
    <div className="flex flex-wrap gap-1 px-1">
      {citations.map((c) => (
        <a
          key={`${c.kbItemId}-${c.page ?? "all"}`}
          href={`/knowledge-bases/${c.knowledgeBaseId}`}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100"
        >
          <FileText className="w-2.5 h-2.5 shrink-0" />
          <span className="max-w-[180px] truncate">
            {c.title}
            {c.page !== undefined ? ` · p.${c.page}` : ""}
          </span>
        </a>
      ))}
    </div>
  );
}
