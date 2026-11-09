import { describe, expect, it } from "vitest";
import {
  CHECKBOX_WIDTH,
  canMove,
  canPin,
  hideColumn,
  moveColumn,
  normalizeLayout,
  pinColumn,
  reorderColumns,
  showColumn,
  stickyOffsets,
  unpinColumn,
} from "./grid-layout";

const base = { keys: ["a", "b", "c", "d"], pins: [] as string[] };

describe("pin order", () => {
  it("pins move directly after the pinned group", () => {
    const one = pinColumn(base, "c");
    expect(one).toEqual({ keys: ["c", "a", "b", "d"], pins: ["c"] });
    const two = pinColumn(one, "d");
    expect(two).toEqual({ keys: ["c", "d", "a", "b"], pins: ["c", "d"] });
  });
  it("caps at two pins", () => {
    const two = pinColumn(pinColumn(base, "a"), "b");
    expect(canPin(two, "c")).toBe(false);
    expect(pinColumn(two, "c")).toBe(two);
    expect(canPin(two, "a")).toBe(true); // already pinned: Unpin stays available
  });
  it("unpin lands first among unpinned", () => {
    const two = pinColumn(pinColumn(base, "c"), "d");
    expect(unpinColumn(two, "c")).toEqual({ keys: ["d", "c", "a", "b"], pins: ["d"] });
  });
  it("normalize drops unknown pins and restores the prefix", () => {
    expect(normalizeLayout(["a", "b", "c"], ["c", "zzz", "a", "b"])).toEqual({ keys: ["c", "a", "b"], pins: ["c", "a"] });
  });
});

describe("move limits", () => {
  const l = pinColumn(base, "c"); // c | a b d
  it("first/last in a group cannot move outward", () => {
    expect(canMove(l, "c", "left")).toBe(false);
    expect(canMove(l, "c", "right")).toBe(false); // pinned group of one
    expect(canMove(l, "a", "left")).toBe(false); // would cross into pinned
    expect(canMove(l, "d", "right")).toBe(false);
    expect(canMove(l, "a", "right")).toBe(true);
  });
  it("swaps within the group", () => {
    expect(moveColumn(l, "b", "left").keys).toEqual(["c", "b", "a", "d"]);
    const two = pinColumn(l, "d"); // c d | a b
    const moved = moveColumn(two, "d", "left");
    expect(moved).toEqual({ keys: ["d", "c", "a", "b"], pins: ["d", "c"] });
  });
  it("unknown key is a no-op", () => {
    expect(canMove(l, "zzz", "left")).toBe(false);
    expect(moveColumn(l, "zzz", "left")).toBe(l);
  });
});

describe("show / hide / reorder", () => {
  it("hide removes the key and its pin", () => {
    expect(hideColumn(pinColumn(base, "b"), "b")).toEqual({ keys: ["a", "c", "d"], pins: [] });
  });
  it("show appends unpinned, once", () => {
    const s = showColumn(base, "z");
    expect(s.keys).toEqual(["a", "b", "c", "d", "z"]);
    expect(showColumn(s, "z")).toBe(s);
  });
  it("reorder keeps pinned columns first", () => {
    const l = pinColumn(base, "c");
    expect(reorderColumns(l, ["a", "b", "c", "d"])).toEqual({ keys: ["c", "a", "b", "d"], pins: ["c"] });
  });
});

describe("sticky offsets", () => {
  it("accumulates checkbox, name and pinned widths", () => {
    expect(stickyOffsets({ nameWidth: 240, pinnedWidths: [100, 120] })).toEqual([
      CHECKBOX_WIDTH,
      CHECKBOX_WIDTH + 240,
      CHECKBOX_WIDTH + 240 + 100,
    ]);
  });
  it("no pins -> only the name offset", () => {
    expect(stickyOffsets({ nameWidth: 200, pinnedWidths: [] })).toEqual([CHECKBOX_WIDTH]);
  });
});
