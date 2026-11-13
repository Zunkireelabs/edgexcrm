"use client";

import { useState } from "react";

export const COLUMN_PAGE_SIZE = 25;

/**
 * Client-side "Show N more" for a board column: renders the first 25 cards, reveals 25 more per click.
 * Kept to this one small hook + button so Phase 3's server paging can swap it out in one place.
 */
export function useRevealedCards<T>(items: T[], pageSize: number = COLUMN_PAGE_SIZE) {
  const [limit, setLimit] = useState(pageSize);
  const visible = items.slice(0, limit);
  const remaining = Math.max(0, items.length - visible.length);
  return {
    visible,
    remaining,
    showMore: () => setLimit((l) => l + pageSize),
    nextBatch: Math.min(pageSize, remaining),
  };
}

export function ShowMoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[30px] shrink-0 rounded-[8px] text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-black/[.04] hover:text-[#101112]"
    >
      Show {count} more
    </button>
  );
}
