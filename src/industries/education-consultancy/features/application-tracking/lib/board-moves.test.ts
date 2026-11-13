// EDGEX-170: "Show N more" counts after a card moves between columns.
import { describe, it, expect } from "vitest";
import { applyMoveCounts, columnMoreCount } from "./board-moves";
import { moveCardBetweenColumns, type PhoneColumnState } from "./phone-board";
import { fromPayload } from "../components/applications-board";
import type { Application } from "@/types/database";

const app = (id: string, stage_id: string): Application =>
  ({ id, stage_id, stage_changed_at: new Date().toISOString(), status: "x" }) as unknown as Application;
const col = (ids: string[], total: number, nextOffset = ids.length, stuck = 0): PhoneColumnState => ({
  cards: ids.map((i) => app(i, "x")), total, stuck, nextOffset, loading: false,
});
// The server's side of paging: rows of one column in order, fetched by offset (like fetchPage).
const page = (rows: string[], offset: number) => rows.slice(offset, offset + 25);

/** Simulates loadPage on a column: append unseen rows, advance the cursor by the page size. */
function showMore(c: PhoneColumnState, server: string[]): PhoneColumnState {
  const rows = page(server, c.nextOffset);
  const have = new Set(c.cards.map((x) => x.id));
  return { ...c, cards: [...c.cards, ...rows.filter((r) => !have.has(r)).map((r) => app(r, "x"))], total: server.length, nextOffset: c.nextOffset + rows.length };
}
const visiblePlusMore = (c: PhoneColumnState) => c.cards.length + Math.max(0, c.total - c.cards.length);

describe("columnMoreCount", () => {
  it("is what is not on screen, capped at a page, never negative", () => {
    expect(columnMoreCount({ cards: new Array(25), total: 71 })).toBe(25);
    expect(columnMoreCount({ cards: new Array(60), total: 71 })).toBe(11);
    expect(columnMoreCount({ cards: new Array(2), total: 2 })).toBe(0);
    expect(columnMoreCount({ cards: new Array(3), total: 2 })).toBe(0);
  });
});

describe("a card moved into a column (desktop drop + phone sheet share applyMoveCounts)", () => {
  it("(b) small, fully loaded column: no phantom 'Show 2 more' (was min(25, 2-1)=1... and 2 cards for total 2)", () => {
    const cols = { a: col(["a1", "a2"], 71), b: col(["b1"], 1) };
    const next = moveCardBetweenColumns(cols, { appId: "a1", from: "a", to: "b", moved: app("a1", "b") });
    expect(next.b.cards.map((c) => c.id)).toEqual(["a1", "b1"]);
    expect(next.b.total).toBe(2);
    expect(columnMoreCount(next.b)).toBe(0); // old formula: total - nextOffset = 1
  });

  it("(a) first page full, more on the server: the button counts only the unloaded rest", () => {
    const server = Array.from({ length: 40 }, (_, i) => "b" + i);
    const dst = col(server.slice(0, 25), 40);
    const cols = { a: col(["a1"], 5), b: dst };
    const next = moveCardBetweenColumns(cols, { appId: "a1", from: "a", to: "b", moved: app("a1", "b") });
    expect(next.b.total).toBe(41);
    expect(next.b.cards).toHaveLength(26);
    expect(columnMoreCount(next.b)).toBe(15); // 41 total - 26 on screen
    // Clicking it: rows 25..39 (+ the moved card wherever the sort put it) -> nothing doubled or skipped.
    const afterClick = showMore(next.b, [...server, "a1"]);
    expect(new Set(afterClick.cards.map((c) => c.id)).size).toBe(afterClick.cards.length);
    expect(afterClick.cards).toHaveLength(41);
    expect(columnMoreCount(afterClick)).toBe(0);
  });

  it("(a2) the moved card sorts INTO the loaded region: the displaced row is re-fetched once, deduped, none skipped", () => {
    const server = ["a1", ...Array.from({ length: 39 }, (_, i) => "b" + i)]; // a1 now sorts first
    const dst = col(server.slice(1, 26), 39); // loaded b0..b24
    const moved = moveCardBetweenColumns({ a: col(["a1"], 5), b: dst }, { appId: "a1", from: "a", to: "b", moved: app("a1", "b") }).b;
    const after = showMore(moved, server);
    expect(after.cards.map((c) => c.id).sort()).toEqual([...server].sort());
    expect(columnMoreCount(after)).toBe(0);
  });

  it("the invariant holds after any number of moves in and out: on screen + to load = total", () => {
    let cols = { a: col(["a1", "a2", "a3"], 30), b: col(["b1", "b2"], 2) };
    for (const [id, from, to] of [["a1", "a", "b"], ["a2", "a", "b"], ["a1", "b", "a"]] as const) {
      cols = moveCardBetweenColumns(cols, { appId: id, from, to, moved: app(id, to) }) as typeof cols;
      for (const c of Object.values(cols)) expect(visiblePlusMore(c)).toBe(c.total);
    }
    expect(columnMoreCount(cols.b)).toBe(0);
  });

  it("(c) Undo puts the card back: source/target counts return, still no phantom button", () => {
    const start = { a: col(["a1", "a2"], 2), b: col(["b1"], 1) };
    const moved = moveCardBetweenColumns(start, { appId: "a1", from: "a", to: "b", moved: app("a1", "b") });
    const undone = moveCardBetweenColumns(moved, { appId: "a1", from: "b", to: "a", moved: app("a1", "a") });
    expect(undone.a.total).toBe(2);
    expect(undone.b.total).toBe(1);
    expect(columnMoreCount(undone.a)).toBe(0);
    expect(columnMoreCount(undone.b)).toBe(0);
  });

  it("(e) the source column after a move-out: cursor follows an index-loaded card; a not-loaded card leaves it alone", () => {
    const loaded = applyMoveCounts({ total: 40, stuck: 2, nextOffset: 25 }, { total: 1, stuck: 0, nextOffset: 1 }, { wasStuck: true, wasLoaded: true });
    expect(loaded.src).toEqual({ total: 39, stuck: 1, nextOffset: 24 });
    expect(loaded.dst).toEqual({ total: 2, stuck: 0, nextOffset: 1 });
    const notLoaded = applyMoveCounts({ total: 40, stuck: 0, nextOffset: 25 }, { total: 1, stuck: 0, nextOffset: 1 }, { wasStuck: false, wasLoaded: false });
    expect(notLoaded.src.nextOffset).toBe(25);
    expect(moveCardBetweenColumns({ a: col(["a1"], 40, 25), b: col([], 0) }, { appId: "zz", from: "a", to: "b", moved: app("zz", "b") }).a.nextOffset).toBe(25);
  });
});

describe("(d) the pin, then the server payload (fromPayload)", () => {
  const payload = (cards: Record<string, string[]>, totals: Record<string, number>) => ({
    columns: Object.fromEntries(Object.entries(cards).map(([s, ids]) => [s, { cards: ids.map((i) => app(i, s)), total: totals[s], stuck: 0 }])),
    total: 0, truncated: false,
  });

  it("server already has the card on page one: no double count, nothing extra", () => {
    const cols = fromPayload(payload({ b: ["a1", "b1"] }, { b: 2 }), { appId: "a1", stageId: "b", card: app("a1", "b") });
    expect(cols.b.cards.map((c) => c.id)).toEqual(["a1", "b1"]);
    expect(columnMoreCount(cols.b)).toBe(0);
  });

  it("server has it beyond page one: pinned card on screen, button counts the rest minus it", () => {
    const ids = Array.from({ length: 25 }, (_, i) => "b" + i);
    const cols = fromPayload(payload({ b: ids }, { b: 41 }), { appId: "a1", stageId: "b", card: app("a1", "b") });
    expect(cols.b.cards).toHaveLength(26);
    expect(columnMoreCount(cols.b)).toBe(15); // 41 - 26; the old formula said 16 and the last click came up one short
  });
});
