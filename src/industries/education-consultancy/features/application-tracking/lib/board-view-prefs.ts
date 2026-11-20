/** Per-user board layout prefs (column width). localStorage only, always try/catch. */
export const COLUMN_WIDTHS = ["narrow", "wide"] as const;
export type ColumnWidth = (typeof COLUMN_WIDTHS)[number];
export const DEFAULT_COLUMN_WIDTH: ColumnWidth = "wide";
/** Wide = Phase 1's 268px column; narrow = 232px (same 11px card inset, so 210px cards). */
export const COLUMN_WIDTH_PX: Record<ColumnWidth, number> = { narrow: 232, wide: 268 };

export const columnWidthKey = (userId: string) => `edgex-applications-column-width:${userId}`;

export function parseColumnWidth(v: unknown): ColumnWidth {
  return v === "narrow" || v === "wide" ? v : DEFAULT_COLUMN_WIDTH;
}

export function readColumnWidth(userId: string): ColumnWidth {
  try {
    return parseColumnWidth(window.localStorage.getItem(columnWidthKey(userId)));
  } catch {
    return DEFAULT_COLUMN_WIDTH;
  }
}

export function writeColumnWidth(userId: string, w: ColumnWidth): void {
  try {
    window.localStorage.setItem(columnWidthKey(userId), w);
  } catch {
    // storage unavailable: the choice just won't persist
  }
}
