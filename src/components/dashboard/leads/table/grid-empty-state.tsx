"use client";

// Designed empty state (EDGEX-117). Replaces the table and footer; pagination stays and reads
// "Showing 0 of 0". Never shown while the table is loading (the caller guards that).

import { MagnifyingGlassIcon, TrayIcon, FunnelSimpleIcon, UsersIcon } from "@/components/icons";

export type EmptyVariant = "filters" | "search" | "nothing" | "none";

export interface EmptyInput {
  /** User-removable filter conditions (a view tab's scope conditions do not count). */
  hasUserFilters: boolean;
  hasSearch: boolean;
  viewMode: "normal" | "trash" | "archived";
}

export function emptyVariant({ hasUserFilters, hasSearch, viewMode }: EmptyInput): EmptyVariant {
  if (hasUserFilters) return "filters";
  if (hasSearch) return "search";
  if (viewMode !== "normal") return "nothing";
  return "none";
}

const BTN =
  "mt-4 inline-flex h-7 items-center rounded-ds-sm px-3 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost";

export function GridEmptyState({
  variant,
  onClearFilters,
  onClearSearch,
  onAddLead,
}: {
  variant: EmptyVariant;
  onClearFilters: () => void;
  onClearSearch: () => void;
  /** Present only when the user can create leads. */
  onAddLead?: () => void;
}) {
  const copy = {
    filters: { Icon: FunnelSimpleIcon, title: "No leads match these filters", body: "Try removing a filter, or check the spelling of your search." },
    search: { Icon: MagnifyingGlassIcon, title: "No leads match your search", body: "Check the spelling, or try a different name, email or phone number." },
    nothing: { Icon: TrayIcon, title: "Nothing here yet", body: "Leads will show up here when there are some." },
    none: { Icon: UsersIcon, title: "No leads yet", body: "Add your first lead to start building your pipeline." },
  }[variant];
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center" data-testid="leads-empty-state" data-variant={variant}>
      <span className="flex size-10 items-center justify-center rounded-ds-md bg-ds-hover text-ds-muted">
        <copy.Icon className="size-5" />
      </span>
      <h2 className="mt-3 text-[15px] font-semibold text-ds-ink">{copy.title}</h2>
      <p className="mt-1 max-w-sm text-sm font-normal text-ds-muted">{copy.body}</p>
      {variant === "filters" && (
        <button type="button" className={BTN} onClick={onClearFilters}>
          Clear filters
        </button>
      )}
      {variant === "search" && (
        <button type="button" className={BTN} onClick={onClearSearch}>
          Clear search
        </button>
      )}
      {variant === "none" && onAddLead && (
        <button type="button" className={BTN} onClick={onAddLead}>
          Add lead
        </button>
      )}
    </div>
  );
}
