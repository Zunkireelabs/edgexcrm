import { describe, it, expect } from "vitest";
import {
  bulkMoveIds,
  classifyMove,
  dedupeReceived,
  indexLists,
  isEditedNote,
  isOutMove,
  noteCounts,
  resolveHolder,
  resolveListRef,
  stageConversion,
  type ListRef,
  type MoveRow,
} from "./definitions";

const L = (id: string, name: string, sortOrder: number, extra: Partial<ListRef> = {}): ListRef => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  sortOrder,
  isArchive: false,
  adminOnly: false,
  ...extra,
});
const preq = L("a", "Pre-qualified", 1);
const qual = L("b", "Qualified", 2);
const prosp = L("c", "Prospects", 3);
const arch = L("z", "Archived", 99, { isArchive: true });

describe("forward / back / out", () => {
  it("is decided by sort_order", () => {
    expect(classifyMove(preq, qual)).toBe("forward");
    expect(classifyMove(prosp, qual)).toBe("back");
    expect(classifyMove(qual, qual)).toBe("lateral");
    expect(classifyMove(null, qual)).toBe("unknown");
  });
  it("out = back or into the archived list", () => {
    expect(isOutMove(prosp, qual)).toBe(true);
    expect(isOutMove(qual, arch)).toBe(true);
    expect(isOutMove(preq, qual)).toBe(false);
    expect(isOutMove(qual, null)).toBe(false);
  });
});

describe("resolveListRef", () => {
  const idx = indexLists([preq, qual, prosp, arch]);
  it("prefers ids", () => {
    expect(resolveListRef(idx, "c", "Qualified")).toMatchObject({ list: { id: "c" }, via: "id" });
  });
  it("falls back to name, case-insensitively", () => {
    expect(resolveListRef(idx, null, " qualified ")).toMatchObject({ list: { id: "b" }, via: "name" });
  });
  it("falls back to slug (check-in wrote slugs into list.old)", () => {
    expect(resolveListRef(idx, null, "pre-qualified")).toMatchObject({ via: "name" }); // slug === lowercased name here
    const idx2 = indexLists([L("q", "New Leads (2026)", 1, { slug: "new" })]);
    expect(resolveListRef(idx2, null, "new")).toMatchObject({ list: { id: "q" }, via: "slug" });
  });
  it("reports unmatched, and an unknown id does not block a name match", () => {
    expect(resolveListRef(idx, null, "Deleted Stage")).toEqual({ list: null, via: "unmatched" });
    expect(resolveListRef(idx, "gone", "Qualified")).toMatchObject({ via: "name" });
  });
});

describe("holder = who held the lead IMMEDIATELY BEFORE the move (review round 1)", () => {
  it("a relay hand-off in the same event credits the SENDER, not the receiver", () => {
    // Esha (counsellor) moves a lead into Applications and re-assigns it to Gita (app executive) in one event.
    // Crediting Gita would credit the receiver for the sender's work.
    expect(resolveHolder({ assignChanged: true, assignedOld: "esha", holderNew: "gita", actorId: "esha" })).toEqual({ userId: "esha", source: "assigned_to" });
  });
  it("assignee unchanged → holder.new IS the holder before", () => {
    expect(resolveHolder({ assignChanged: false, holderNew: "esha", actorId: "esha" })).toEqual({ userId: "esha", source: "holder" });
  });
  it("assignee changed from nobody → the actor delivered it", () => {
    expect(resolveHolder({ assignChanged: true, assignedOld: null, actorId: "esha" })).toEqual({ userId: "esha", source: "actor" });
  });
  it("rows without holder: latest prior assigned_to change, then the current assignee (reported fallback)", () => {
    expect(resolveHolder({ priorAssignee: "p", currentAssignee: "c" })).toEqual({ userId: "p", source: "prior_audit" });
    expect(resolveHolder({ currentAssignee: "c" })).toEqual({ userId: "c", source: "current_fallback" });
    expect(resolveHolder({})).toEqual({ userId: null, source: "none" });
  });
  it("assigned_to.old beats holder.new when both exist (the receiver is in holder.new)", () => {
    expect(resolveHolder({ assignChanged: true, assignedOld: "sender", holderNew: "receiver" }).userId).toBe("sender");
  });
});

describe("stage conversion never exceeds 100%", () => {
  it("is forward ÷ base", () => {
    expect(stageConversion(12, 60)).toBeCloseTo(0.2);
    expect(stageConversion(0, 60)).toBe(0);
  });
  it("12 forward out of a base of 10 is impossible by construction — and is clamped if data ever disagrees", () => {
    expect(stageConversion(12, 10)).toBe(1);
  });
  it("is null when nothing was in the stage", () => {
    expect(stageConversion(0, 0)).toBeNull();
  });
});

describe("bulk heuristic", () => {
  const rows = (n: number, startMs = Date.UTC(2026, 10, 1, 10, 0, 0)): MoveRow[] =>
    Array.from({ length: n }, (_, i) => ({ id: `m${i}`, actorId: "u1", at: new Date(startMs + i * 1000) }));
  it("exactly 20 rows in one 60s bucket is bulk", () => {
    expect(bulkMoveIds(rows(20), 20, 60).size).toBe(20);
  });
  it("19 rows is not", () => {
    expect(bulkMoveIds(rows(19), 20, 60).size).toBe(0);
  });
  it("rows split across two buckets don't add up", () => {
    const base = Date.UTC(2026, 10, 1, 10, 0, 40);
    const split = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, actorId: "u1", at: new Date(base + i * 1500) }));
    // 40s..70s straddles the minute boundary → 14 + 6
    expect(bulkMoveIds(split, 20, 60).size).toBe(0);
  });
  it("different actors don't pool", () => {
    const mixed = rows(20).map((r, i) => ({ ...r, actorId: i % 2 ? "u1" : "u2" }));
    expect(bulkMoveIds(mixed, 20, 60).size).toBe(0);
  });
  it("tagged rows count toward the bucket (parity with the SQL): 19 untagged + 1 tagged = 20 = bulk", () => {
    const r = rows(20).map((x, i) => (i === 0 ? { ...x, via: "bulk" } : x));
    expect(bulkMoveIds(r, 20, 60).size).toBe(20);
  });
  it("an explicit via=bulk tag counts regardless of volume", () => {
    expect(bulkMoveIds([{ id: "x", actorId: "u", at: new Date(), via: "bulk" }], 20, 60).has("x")).toBe(true);
  });
});

describe("notes", () => {
  const t0 = new Date("2026-11-01T10:00:00Z");
  it("edited needs > 1 minute after creation", () => {
    expect(isEditedNote(t0, new Date(t0.getTime() + 60_000))).toBe(false);
    expect(isEditedNote(t0, new Date(t0.getTime() + 60_001))).toBe(true);
    expect(isEditedNote(t0, null)).toBe(false);
  });
  it("excludes AI-written notes and notes on deleted leads", () => {
    expect(noteCounts({ aiToolCallId: null, leadDeleted: false })).toBe(true);
    expect(noteCounts({ aiToolCallId: "tc1", leadDeleted: false })).toBe(false);
    expect(noteCounts({ aiToolCallId: null, leadDeleted: true })).toBe(false);
  });
});

describe("received-leads de-duplication", () => {
  it("a lead created-and-assigned in the window (in both sources) counts once", () => {
    const m = dedupeReceived(
      [{ leadId: "l1", userId: "u1" }, { leadId: "l2", userId: "u1" }],
      [{ leadId: "l1", userId: "u1" }, { leadId: "l3", userId: "u2" }],
    );
    expect(m.get("u1")).toBe(2);
    expect(m.get("u2")).toBe(1);
  });
  it("the same lead handed to two people counts for each", () => {
    const m = dedupeReceived([{ leadId: "l1", userId: "u1" }, { leadId: "l1", userId: "u2" }], []);
    expect([m.get("u1"), m.get("u2")]).toEqual([1, 1]);
  });
});
