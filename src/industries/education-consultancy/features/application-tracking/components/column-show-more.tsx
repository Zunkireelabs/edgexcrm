"use client";

/**
 * "Show N more" at the bottom of a board column / under the list (mockup `.more`). The board pages
 * from the server (GET /api/v1/applications/board-page, EDGEX-141 Phase 3); this is only the button.
 */
export function ShowMoreButton({ count, loading = false, onClick }: { count: number; loading?: boolean; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      data-testid="column-show-more"
      onClick={onClick}
      disabled={loading}
      className="h-[30px] shrink-0 rounded-[8px] text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-black/[.04] hover:text-[#101112] disabled:opacity-60"
    >
      {loading ? "Loading…" : `Show ${count} more`}
    </button>
  );
}
