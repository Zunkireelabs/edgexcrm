// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mergeById, mergeUnion } from "./quiet-refresh";

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

describe("mergeUnion (messages: the server list is only a window)", () => {
  const m = (id: string, t: string, text = id) => ({ id, created_at: t, text });
  const m1 = m("m1", "2026-11-24T10:00:00Z");
  const m2 = m("m2", "2026-11-24T10:01:00Z");

  it("returns the very same list when nothing changed", () => {
    const prev = [m1, m2];
    expect(mergeUnion(prev, [{ ...m1 }, { ...m2 }])).toBe(prev);
  });
  it("never removes a message the server window no longer lists", () => {
    const prev = [m1, m2];
    const out = mergeUnion(prev, [{ ...m1 }]);
    expect(out).toBe(prev);
  });
  it("adds new messages and keeps the chat in time order", () => {
    const m3 = m("m3", "2026-11-24T10:02:00Z");
    const early = m("m0", "2026-11-24T09:59:00Z");
    expect(mergeUnion([m1, m3], [m2]).map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(mergeUnion([m1], [early]).map((r) => r.id)).toEqual(["m0", "m1"]);
  });
  it("updates a message that changed and keeps the untouched ones as they were", () => {
    const out = mergeUnion([m1, m2], [{ ...m1 }, { ...m2, text: "edited" }]);
    expect(out[0]).toBe(m1);
    expect(out[1].text).toBe("edited");
  });
});
