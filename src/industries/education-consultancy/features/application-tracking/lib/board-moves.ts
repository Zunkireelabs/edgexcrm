// EDGEX-170: the ONE place a card moving between board columns is accounted for. The desktop drop
// (handleDragEnd) and the phone Move sheet (moveCardBetweenColumns) both go through here, so their
// counts can't drift.
//
// The invariant: cards on screen + cards still to load = the column's total. "Still to load" is
// therefore total - cards.length, NOT total - nextOffset: a card moved in (or pinned) is on screen
// but isn't an index-loaded row, so nextOffset undercounts what's visible. nextOffset stays the
// paging cursor only. Paging never skips or doubles a card: loadPage dedupes by id, and a
// nextOffset that is at most the loaded prefix can only re-fetch a row, never jump past one.

import { COLUMN_PAGE_SIZE } from "./board-index";

export interface MoveCounts {
  total: number;
  stuck: number;
  nextOffset: number;
}

/** "Show N more": what's genuinely not on screen yet, capped at one page. 0 hides the button. */
export function columnMoreCount(col: { cards: readonly unknown[]; total: number }, pageSize: number = COLUMN_PAGE_SIZE): number {
  return Math.min(pageSize, Math.max(0, col.total - col.cards.length));
}

/**
 * The counts after one card leaves `src` and enters `dst`. Source: total/stuck down, and the paging
 * cursor down when the card was an index-loaded row (a not-loaded card sat past the cursor, which
 * doesn't move). Target: total up only; the card itself is on screen (cards.length), and the
 * cursor is left alone because the card's server position is unknown (it depends on the sort).
 */
export function applyMoveCounts<S extends MoveCounts, D extends MoveCounts>(
  src: S,
  dst: D,
  opts: { wasStuck: boolean; wasLoaded: boolean },
): { src: S; dst: D } {
  return {
    src: {
      ...src,
      total: Math.max(0, src.total - 1),
      stuck: Math.max(0, src.stuck - (opts.wasStuck ? 1 : 0)),
      nextOffset: opts.wasLoaded ? Math.max(0, src.nextOffset - 1) : src.nextOffset,
    },
    dst: { ...dst, total: dst.total + 1 },
  };
}
