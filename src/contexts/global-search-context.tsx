"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { NavResult } from "@/components/dashboard/search/build-nav-index";

interface GlobalSearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** The keyboard shortcut chip label (⌘K on Mac, Ctrl K on others). */
  shortcutLabel: string;
}

const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

export function useGlobalSearch(): GlobalSearchContextValue {
  const ctx = useContext(GlobalSearchContext);
  if (!ctx) {
    // Graceful fallback when called outside the provider
    return {
      isOpen: false,
      open: () => {},
      close: () => {},
      toggle: () => {},
      shortcutLabel: "⌘K",
    };
  }
  return ctx;
}

// Lazy-load the palette so it doesn't block the initial render
const GlobalSearchPalette = dynamic(
  () =>
    import("@/components/dashboard/search/global-search-palette").then(
      (m) => m.GlobalSearchPalette
    ),
  { ssr: false }
);

interface GlobalSearchProviderProps {
  children: ReactNode;
  navIndex: NavResult[];
}

export function GlobalSearchProvider({
  children,
  navIndex,
}: GlobalSearchProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Default to ⌘K; updated after mount to avoid hydration mismatch
  const [shortcutLabel, setShortcutLabel] = useState("⌘K");

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Resolve the correct modifier key label after mount (client-only)
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShortcutLabel(isMac ? "⌘K" : "Ctrl K");
  }, []);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <GlobalSearchContext.Provider
      value={{ isOpen, open, close, toggle, shortcutLabel }}
    >
      {children}
      <GlobalSearchPalette
        isOpen={isOpen}
        onClose={close}
        navIndex={navIndex}
      />
    </GlobalSearchContext.Provider>
  );
}
