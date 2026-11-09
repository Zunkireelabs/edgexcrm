"use client";

import { CaretLeftIcon, CaretRightIcon } from "@/components/icons";

const NAV =
  "inline-flex size-7 items-center justify-center rounded-ds-xs text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost";

export function GridPagination({
  total,
  start,
  end,
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  /** 0-based index of the first row on this page. */
  start: number;
  /** Exclusive end index. */
  end: number;
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-t border-ds-border bg-ds-surface px-3 text-sm font-medium text-ds-muted">
      <span className="tabular-nums" data-testid="leads-showing">
        {total === 0 ? "Showing 0 of 0" : `Showing ${(start + 1).toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-7 rounded-ds-xs bg-ds-surface px-1.5 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" className={NAV} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <CaretLeftIcon className="size-4" />
          </button>
          <span className="px-1 tabular-nums">
            Page {page} of {totalPages || 1}
          </span>
          <button type="button" className={NAV} disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
            <CaretRightIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
