"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface AIAssistantContextValue {
  isOpen: boolean;
  /** With a question, the panel opens with it typed into the input (never sent: the person presses send). */
  openAssistant: (question?: string) => void;
  /** The last question handed to openAssistant; `nonce` changes on every call so the same question can be sent twice. */
  prefill: { text: string; nonce: number } | null;
  closeAssistant: () => void;
  toggleAssistant: () => void;
}

const AIAssistantContext = createContext<AIAssistantContextValue | null>(null);

export function AIAssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const openAssistant = useCallback((question?: string) => {
    if (typeof question === "string" && question.trim()) setPrefill({ text: question.trim(), nonce: Date.now() });
    setIsOpen(true);
  }, []);
  const closeAssistant = useCallback(() => setIsOpen(false), []);
  const toggleAssistant = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <AIAssistantContext.Provider
      value={{ isOpen, openAssistant, prefill, closeAssistant, toggleAssistant }}
    >
      {children}
    </AIAssistantContext.Provider>
  );
}

export function useAIAssistant() {
  const context = useContext(AIAssistantContext);
  if (!context) {
    throw new Error("useAIAssistant must be used within AIAssistantProvider");
  }
  return context;
}
