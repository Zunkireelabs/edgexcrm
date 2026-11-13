"use client";

// "Search leads  /" — 28px hairline field (mockup `.search`). The `/` hint is a real shortcut
// (focus), handled by LeadsToolbar. Server-side search; the debounce lives in leads-table.

import { forwardRef } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  /** Defaults are the Leads strings, so Leads renders byte-identically. */
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ value, onChange, loading, placeholder = "Search leads", ariaLabel = "Search leads", testId = "leads-search" }, ref) {
  return (
    <label className="flex h-7 w-[220px] shrink-0 items-center gap-2 rounded-ds-sm bg-ds-surface px-2 text-ds-faint shadow-[inset_0_0_0_1px_var(--ds-border)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--ds-ghost)] hover:shadow-[inset_0_0_0_1px_var(--ds-ghost)]">
      <MagnifyingGlassIcon className="size-4 shrink-0" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-ds-ink outline-none placeholder:font-medium placeholder:text-ds-faint"
      />
      {loading ? (
        <span aria-hidden="true" className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-ds-ghost border-t-ds-muted" />
      ) : (
        <kbd className="shrink-0 rounded-[4px] border border-ds-border px-1.5 text-[11px] font-medium leading-4 text-ds-faint">/</kbd>
      )}
    </label>
  );
});
