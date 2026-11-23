"use client";

import { useState, useRef, useEffect } from "react";
import { PaperPlaneTiltIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Shown just above the input while `disabled` is true, so the user knows why they can't type. */
  disabledHint?: string;
  /** A question to put in the box (Home's "Ask Orca" chips). Typed in, not sent. A new `nonce` puts it in again. */
  prefill?: { text: string; nonce: number } | null;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Ask anything...",
  disabledHint,
  prefill,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A prefill older than this input (a new chat remounts it) is stale: only apply ones made while it is mounted. Applied during
  // render (the "adjust state when a prop changes" pattern), once per nonce, so there is no effect that sets state.
  const [mountedAt] = useState(() => Date.now());
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (prefill && prefill.nonce >= mountedAt && prefill.nonce !== appliedNonce) {
    setAppliedNonce(prefill.nonce);
    setMessage(prefill.text);
  }
  useEffect(() => {
    if (appliedNonce !== null) textareaRef.current?.focus();
  }, [appliedNonce]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setMessage("");
      // Reset height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="px-4 pb-0">
      {disabled && disabledHint && (
        <p className="px-1 pb-2 text-xs text-gray-500">{disabledHint}</p>
      )}
      <div className="relative rounded-2xl border border-gray-200 bg-white shadow-sm focus-within:border-gray-300 focus-within:shadow transition-all">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={disabled || !message.trim()}
          className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-full shrink-0"
        >
          <PaperPlaneTiltIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
