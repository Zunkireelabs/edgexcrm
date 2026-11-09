// Pure column ordering / pin / sticky-offset maths for the v2 leads grid (EDGEX-117).
// Invariant: `keys` is the displayed order of the non-Name columns, and `pins` is always the
// leading prefix of `keys` (in pin order). Name itself is always first and is not in `keys`.

export const MAX_PINS = 2;
export const CHECKBOX_WIDTH = 44;
export const DEFAULT_COLUMN_WIDTH = 160;

export interface ColumnLayout {
  keys: string[];
  pins: string[];
}

/** Restore the invariant: drop unknown pins, cap the count, and put pins first in pin order. */
export function normalizeLayout(keys: string[], pins: string[]): ColumnLayout {
  const unique = Array.from(new Set(keys));
  const set = new Set(unique);
  const kept = Array.from(new Set(pins)).filter((p) => set.has(p)).slice(0, MAX_PINS);
  const pinned = new Set(kept);
  return { keys: [...kept, ...unique.filter((k) => !pinned.has(k))], pins: kept };
}

export function canPin(layout: ColumnLayout, key: string): boolean {
  return layout.pins.includes(key) || layout.pins.length < MAX_PINS;
}

/** Pin moves the column directly after the existing pinned group. */
export function pinColumn(layout: ColumnLayout, key: string): ColumnLayout {
  if (!layout.keys.includes(key) || layout.pins.includes(key) || layout.pins.length >= MAX_PINS) return layout;
  return normalizeLayout(layout.keys, [...layout.pins, key]);
}

/** Unpin puts the column first among the unpinned ones, right after the pinned group. */
export function unpinColumn(layout: ColumnLayout, key: string): ColumnLayout {
  if (!layout.pins.includes(key)) return layout;
  const pins = layout.pins.filter((p) => p !== key);
  const rest = layout.keys.filter((k) => !pins.includes(k) && k !== key);
  return { keys: [...pins, key, ...rest], pins };
}

function groupRange(layout: ColumnLayout, key: string): [number, number] | null {
  const idx = layout.keys.indexOf(key);
  if (idx < 0) return null;
  return layout.pins.includes(key) ? [0, layout.pins.length - 1] : [layout.pins.length, layout.keys.length - 1];
}

export function canMove(layout: ColumnLayout, key: string, dir: "left" | "right"): boolean {
  const range = groupRange(layout, key);
  if (!range) return false;
  const idx = layout.keys.indexOf(key);
  return dir === "left" ? idx > range[0] : idx < range[1];
}

/** Swap with the neighbour in the same group (pinned columns never cross into unpinned ones). */
export function moveColumn(layout: ColumnLayout, key: string, dir: "left" | "right"): ColumnLayout {
  if (!canMove(layout, key, dir)) return layout;
  const keys = [...layout.keys];
  const idx = keys.indexOf(key);
  const swap = dir === "left" ? idx - 1 : idx + 1;
  [keys[idx], keys[swap]] = [keys[swap], keys[idx]];
  return { keys, pins: keys.slice(0, layout.pins.length).filter((k) => layout.pins.includes(k)) };
}

export function hideColumn(layout: ColumnLayout, key: string): ColumnLayout {
  return normalizeLayout(
    layout.keys.filter((k) => k !== key),
    layout.pins.filter((p) => p !== key),
  );
}

export function showColumn(layout: ColumnLayout, key: string): ColumnLayout {
  if (layout.keys.includes(key)) return layout;
  return { keys: [...layout.keys, key], pins: layout.pins };
}

/** After a drag in View settings. Pinned columns keep their relative drag order but stay first. */
export function reorderColumns(layout: ColumnLayout, nextKeys: string[]): ColumnLayout {
  const pins = [...layout.pins].sort((a, b) => nextKeys.indexOf(a) - nextKeys.indexOf(b));
  return normalizeLayout(nextKeys, pins);
}

export interface StickyInput {
  nameWidth: number;
  pinnedWidths: number[];
}

/** Left offsets: [name, ...pinned]. The checkbox sits at 0. */
export function stickyOffsets({ nameWidth, pinnedWidths }: StickyInput): number[] {
  const offsets = [CHECKBOX_WIDTH];
  let acc = CHECKBOX_WIDTH + nameWidth;
  for (const w of pinnedWidths) {
    offsets.push(acc);
    acc += w;
  }
  return offsets;
}
