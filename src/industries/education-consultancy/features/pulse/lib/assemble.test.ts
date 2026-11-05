import { describe, it, expect } from "vitest";
import { assemblePeople } from "./assemble";
import type { PersonBucketRow, PersonInfo } from "./types";

const info = (id: string): PersonInfo => ({ userId: id, name: id, email: null, positionSlug: "telecaller", positionName: "TeleCaller", branchId: null, branchName: null });
const row = (user_id: string, bucket: number, calls: number, extra: Partial<PersonBucketRow> = {}): PersonBucketRow => ({
  user_id, bucket, counts: { calls }, notes_new: 0, notes_edited: 0, moves_by_stage: {}, bulk_moves: 0, ...extra,
});

describe("assemblePeople", () => {
  it("bucket 0 is current, bucket 1 previous, usual = mean of buckets 1..4", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 10), row("a", 1, 8), row("a", 2, 4), row("a", 3, 0), row("a", 4, 4)]);
    expect(p.current.calls).toBe(10);
    expect(p.previous.calls).toBe(8);
    expect(p.usual.calls).toBe(4); // (8+4+0+4)/4
  });
  it("a missing bucket counts as zero in the usual mean (a quiet week is data, not a gap)", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 5), row("a", 1, 8)]);
    expect(p.usual.calls).toBe(2); // 8/4
  });
  it("people with no rows still appear, all zero (a collapsed person must not vanish)", () => {
    const [p] = assemblePeople([info("ghost")], []);
    expect(p.current.calls).toBe(0);
    expect(p.trend).toEqual([0, 0, 0, 0, 0]);
  });
  it("trend runs oldest usual window → current window", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 1), row("a", 1, 2), row("a", 2, 3), row("a", 3, 4), row("a", 4, 5)]);
    expect(p.trend).toEqual([5, 4, 3, 2, 1]);
  });
  it("does not leak another person's rows", () => {
    const [a] = assemblePeople([info("a")], [row("b", 0, 99)]);
    expect(a.current.calls).toBe(0);
  });
  it("carries notes split, stage breakdown and the bulk tally for the current window only", () => {
    const [p] = assemblePeople([info("a")], [
      row("a", 0, 1, { notes_new: 3, notes_edited: 1, moves_by_stage: { s1: 2 }, bulk_moves: 7 }),
      row("a", 1, 1, { notes_new: 50, bulk_moves: 50 }),
    ]);
    expect([p.notesNew, p.notesEdited, p.movesByStage, p.bulkMoves]).toEqual([3, 1, { s1: 2 }, 7]);
  });
});
