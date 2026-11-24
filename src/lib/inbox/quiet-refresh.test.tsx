// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mergeById } from "./quiet-refresh";

describe("mergeById", () => {
  const a = { id: "a", text: "one" };
  const b = { id: "b", text: "two" };

  it("returns the very same list when nothing changed (so nothing redraws)", () => {
    const prev = [a, b];
    expect(mergeById(prev, [{ ...a }, { ...b }])).toBe(prev);
  });
  it("keeps the old object for rows that did not change, and takes the new one for rows that did", () => {
    const next = [{ ...a }, { id: "b", text: "edited" }, { id: "c", text: "new" }];
    const out = mergeById([a, b], next);
    expect(out[0]).toBe(a);
    expect(out[1]).toEqual({ id: "b", text: "edited" });
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("follows the server's order and drops rows the server no longer has", () => {
    const out = mergeById([a, b], [{ ...b }]);
    expect(out).toEqual([b]);
    expect(out[0]).toBe(b);
    const swapped = mergeById([a, b], [{ ...b }, { ...a }]);
    expect(swapped.map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("handles an empty list on either side", () => {
    const empty: typeof a[] = [];
    expect(mergeById(empty, [])).toBe(empty);
    expect(mergeById([], [a])).toEqual([a]);
  });
});
