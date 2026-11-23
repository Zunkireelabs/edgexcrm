export interface NavState {
  /** 1-based position across the whole view. */
  position: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Where J/K lands: a row on this page, or the neighbouring page (first/last row of it). */
  next: { kind: "row"; index: number } | { kind: "page"; page: number; edge: "first" } | null;
  prev: { kind: "row"; index: number } | { kind: "page"; page: number; edge: "last" } | null;
}

/** J/K boundary + cross-page logic. `rowIndex` is 0-based in the loaded page; `page` is 1-based. */
export function navState(input: { rowIndex: number; rowCount: number; page: number; pageSize: number; total: number }): NavState {
  const { rowIndex, rowCount, page, pageSize, total } = input;
  const position = (page - 1) * pageSize + rowIndex + 1;
  const hasNext = position < total;
  const hasPrev = position > 1;
  return {
    position,
    total,
    hasPrev,
    hasNext,
    next: !hasNext ? null : rowIndex < rowCount - 1 ? { kind: "row", index: rowIndex + 1 } : { kind: "page", page: page + 1, edge: "first" },
    prev: !hasPrev ? null : rowIndex > 0 ? { kind: "row", index: rowIndex - 1 } : { kind: "page", page: page - 1, edge: "last" },
  };
}

/** J/K only fire when focus is not in a text field and no dialog/menu is open. */
export function shouldHandleNavKey(target: EventTarget | null, doc: Document = document): boolean {
  const el = target as HTMLElement | null;
  if (el) {
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return false;
  }
  return !doc.querySelector('[role="dialog"][data-state="open"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
}
