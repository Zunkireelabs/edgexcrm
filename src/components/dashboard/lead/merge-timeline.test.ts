import { describe, it, expect } from "vitest";
import { mergeNewestFirst } from "./merge-timeline";

const e = (id: string, at: string) => ({ id, at });
const ids = (m: ReturnType<typeof mergeNewestFirst<{ id: string; at: string }, { id: string; at: string }>>) => m.map((x) => x.entry.id);

describe("mergeNewestFirst", () => {
  it("slots the extras between the notes by date, newest first", () => {
    const notes = [e("n3", "2026-10-09T10:00:00Z"), e("n2", "2026-10-07T10:00:00Z"), e("n1", "2026-10-01T10:00:00Z")];
    const extras = [e("call-old", "2026-10-02T10:00:00Z"), e("meeting-new", "2026-10-08T10:00:00Z")];
    expect(ids(mergeNewestFirst(notes, extras))).toEqual(["n3", "meeting-new", "n2", "call-old", "n1"]);
  });

  it("with no extras the notes come back exactly as given (order untouched)", () => {
    const notes = [e("b", "2026-10-01T00:00:00Z"), e("a", "2026-10-05T00:00:00Z")]; // deliberately not date-sorted
    expect(ids(mergeNewestFirst(notes, []))).toEqual(["b", "a"]);
  });

  it("never reshuffles the notes among themselves, even when they are not in date order", () => {
    const notes = [e("first", "2026-10-01T00:00:00Z"), e("second", "2026-10-05T00:00:00Z")];
    const out = ids(mergeNewestFirst(notes, [e("x", "2026-10-03T00:00:00Z")]));
    expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
  });

  it("only extras: sorted newest first", () => {
    expect(ids(mergeNewestFirst([], [e("a", "2026-10-01T00:00:00Z"), e("b", "2026-10-09T00:00:00Z")]))).toEqual(["b", "a"]);
  });

  it("an equal time keeps the note before the call or meeting", () => {
    const out = mergeNewestFirst([e("note", "2026-10-05T00:00:00Z")], [e("call", "2026-10-05T00:00:00Z")]);
    expect(out.map((x) => x.source)).toEqual(["primary", "extra"]);
  });

  it("an unreadable date sorts as the oldest instead of breaking the list", () => {
    expect(ids(mergeNewestFirst([e("n", "2026-10-05T00:00:00Z")], [e("bad", "not a date")]))).toEqual(["n", "bad"]);
  });

  it("empty in, empty out", () => {
    expect(mergeNewestFirst([], [])).toEqual([]);
  });
});
