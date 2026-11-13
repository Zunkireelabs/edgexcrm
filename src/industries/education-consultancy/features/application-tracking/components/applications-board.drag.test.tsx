// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import { ApplicationsBoard, moveCardForDrag, isPingPong } from "./applications-board";
import { assembleBoardPayload, buildBoardIndex, firstPageIds, type IndexRow } from "../lib/board-index";
import type { Application, ApplicationStage } from "@/types/database";

// EDGEX-169: dragging a card back into a LONG column crashed the board ("Maximum update depth exceeded").
// jsdom has no layout, so getBoundingClientRect is faked from the live DOM: columns side by side,
// cards stacked in them (so moving a card really shifts the geometry, like the browser), and the
// DragOverlay clone following the pointer.

const stage = (o: Partial<ApplicationStage>): ApplicationStage =>
  ({ tenant_id: "t", slug: "s", created_at: "", updated_at: "", is_default: false, is_terminal: false, terminal_type: null, color: "#3b82f6", pipeline_id: "p1", ...o }) as ApplicationStage;
const stages = [
  stage({ id: "long", name: "New", position: 0, is_default: true }),
  stage({ id: "short", name: "Contacted", position: 1 }),
  stage({ id: "empty", name: "Offer", position: 2 }),
];
const app = (id: string, stage_id: string): Application =>
  ({
    id, lead_id: "l" + id, university_name: "Uni " + id, program_name: "Prog", stage_id, pipeline_id: null, status: "x",
    stage_changed_at: new Date().toISOString(), created_at: "2026-01-01", updated_at: "2026-01-01",
    application_deadline: null, assigned_to: null, countries: [], intake_term: null,
    offer_type: null, leads: { id: "l" + id, first_name: "A", last_name: "B", email: null },
  }) as unknown as Application;

const longApps = Array.from({ length: 40 }, (_, i) => app("n" + i, "long"));
const apps = [...longApps, app("c1", "short")];
const pipelines = [{ id: "p1", is_default: true, position: 0 }];

function serverFor(list: Application[]) {
  const index = buildBoardIndex({
    rows: list as unknown as IndexRow[], stages, pipelines, selectedPipelineId: "p1", pipelineStages: stages, sort: "stage", nowMs: Date.now(),
  });
  const byId = new Map(list.map((a) => [a.id, a]));
  const cards = firstPageIds(index, stages).map((id) => byId.get(id)!);
  const board = assembleBoardPayload(index, stages, cards, false);
  const fetchPage = vi.fn(async (sid: string, offset: number) => {
    const col = index.byStage[sid] ?? [];
    const items = col.slice(offset, offset + 25);
    return { cards: items.map((r) => byId.get(r.id)!), total: col.length, hasMore: offset + items.length < col.length };
  });
  return { board, fetchPage };
}

const COL_W = 280, HEAD = 60, CARD_H = 80, GAP = 8, VIEW_H = 700;
const pointer = { x: 0, y: 0 };
const rectOf = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;

function fakeRect(this: Element): DOMRect {
  const el = this as HTMLElement;
  const col = el.closest("[data-testid=board-column]") as HTMLElement | null;
  const board = el.closest("[data-testid=applications-board]");
  if (el.getAttribute("data-testid") === "board-column") {
    const i = Array.from(el.parentElement!.querySelectorAll(":scope > [data-testid=board-column]")).indexOf(el);
    const n = el.querySelectorAll("[data-testid=application-card]").length;
    return rectOf(i * (COL_W + GAP), 0, COL_W, Math.min(VIEW_H, HEAD + n * (CARD_H + GAP))); // max-h-full scrolls
  }
  if (el.getAttribute("data-testid") === "application-card-overlay") return rectOf(pointer.x - COL_W / 2, pointer.y - CARD_H / 2, COL_W - 22, CARD_H);
  if (el.getAttribute("data-testid") === "application-card") {
    if (!col) return rectOf(pointer.x - COL_W / 2, pointer.y - CARD_H / 2, COL_W - 22, CARD_H); // the DragOverlay clone
    const ci = Array.from(col.parentElement!.querySelectorAll(":scope > [data-testid=board-column]")).indexOf(col);
    const idx = Array.from(col.querySelectorAll("[data-testid=application-card]")).indexOf(el);
    // like a real browser, the rect includes the CSS transform dnd-kit's sortable strategy applies
    const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(el.style.transform || "");
    const tx = m ? parseFloat(m[1]) : 0, ty = m ? parseFloat(m[2]) : 0;
    return rectOf(ci * (COL_W + GAP) + 11 + tx, HEAD + idx * (CARD_H + GAP) + ty, COL_W - 22, CARD_H);
  }
  if (board) return rectOf(0, 0, 3 * (COL_W + GAP), VIEW_H);
  return rectOf(0, 0, 0, 0);
}

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary = true;
  pointerType = "mouse";
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true });
  vi.stubGlobal("PointerEvent", FakePointerEvent);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  const { board, fetchPage } = serverFor(apps);
  const patch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: "x" } }) }));
  vi.stubGlobal("fetch", patch);
  const view = render(
    <ApplicationsBoard
      stages={stages} board={board} fetchPage={fetchPage} stageTotals={{}} pipelineId="p1" userId="u1"
      canManageApplications isAdmin onRefresh={vi.fn()} onAddToStage={vi.fn()} onEditStages={vi.fn()}
    />,
  );
  const colOf = (id: string) => view.container.querySelector(`[data-stage-id="${id}"]`)!;
  const cardIds = (id: string) => Array.from(colOf(id).querySelectorAll("[data-testid=application-card]")).map((c) => c.getAttribute("data-app-id"));
  await waitFor(() => expect(view.container.querySelector('[data-stage-id="long"]')).not.toBeNull());
  return { view, patch, colOf, cardIds };
}

function down(el: Element, x: number, y: number) {
  pointer.x = x; pointer.y = y;
  act(() => { el.dispatchEvent(new FakePointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, button: 0 })); });
}
function move(x: number, y: number) {
  pointer.x = x; pointer.y = y;
  act(() => { document.dispatchEvent(new FakePointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y })); });
}
function up(x: number, y: number) {
  act(() => { document.dispatchEvent(new FakePointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y })); });
}
const path = (from: [number, number], to: [number, number], steps = 12) =>
  Array.from({ length: steps }, (_, i) => [from[0] + ((to[0] - from[0]) * (i + 1)) / steps, from[1] + ((to[1] - from[1]) * (i + 1)) / steps] as const);

const LONG_X = COL_W / 2;
const SHORT_X = COL_W + GAP + COL_W / 2;

describe("ApplicationsBoard drag between a short and a long column (EDGEX-169)", () => {
  it("drags a card from the short column back into the long one without crashing, one PATCH", async () => {
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const { colOf, cardIds, patch } = await setup();
    const card = colOf("short").querySelector("[data-testid=application-card]")!;
    down(card, SHORT_X, HEAD + 40);
    for (const [x, y] of path([SHORT_X, HEAD + 40], [LONG_X, 400])) move(x, y);
    // pointer sits in the middle of the long column; the card must still be a single, sane member of it
    expect(errs.mock.calls.flat().join(" ")).not.toMatch(/Maximum update depth/);
    up(LONG_X, 400);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((patch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ stage_id: "long" });
    expect(cardIds("long")).toContain("c1");
    expect(cardIds("short")).not.toContain("c1");
    expect(errs.mock.calls.flat().join(" ")).not.toMatch(/Maximum update depth/);
  });

  it("drags a card from the long column into the short one", async () => {
    const { colOf, cardIds, patch } = await setup();
    const card = colOf("long").querySelector("[data-app-id=n0]")!;
    down(card, LONG_X, HEAD + 40);
    for (const [x, y] of path([LONG_X, HEAD + 40], [SHORT_X, HEAD + 40])) move(x, y);
    up(SHORT_X, HEAD + 40);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(cardIds("short")).toContain("n0");
    expect(cardIds("long")).not.toContain("n0");
  });

  it("drags onto an empty column", async () => {
    const { colOf, cardIds, patch } = await setup();
    const card = colOf("short").querySelector("[data-testid=application-card]")!;
    const EMPTY_X = 2 * (COL_W + GAP) + COL_W / 2;
    down(card, SHORT_X, HEAD + 40);
    for (const [x, y] of path([SHORT_X, HEAD + 40], [EMPTY_X, HEAD + 30])) move(x, y);
    up(EMPTY_X, HEAD + 30);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(cardIds("empty")).toEqual(["c1"]);
  });
});

describe("drag overlay + guards (EDGEX-169)", () => {
  it("the overlay clone is presentational: no sortable attributes, and the id is registered once", async () => {
    const { view, colOf } = await setup();
    const card = colOf("short").querySelector("[data-testid=application-card]")!;
    down(card, SHORT_X, HEAD + 40);
    for (const [x, y] of path([SHORT_X, HEAD + 40], [SHORT_X + 60, HEAD + 120], 4)) move(x, y);
    const overlay = view.baseElement.querySelector("[data-testid=application-card-overlay]")!;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute("aria-roledescription")).toBeNull();
    expect(overlay.getAttribute("data-app-id")).toBeNull();
    expect(overlay.getAttribute("tabindex")).toBeNull();
    expect(view.baseElement.querySelectorAll("[data-app-id=c1]")).toHaveLength(1);
    up(SHORT_X + 60, HEAD + 120);
  });

  const col = (ids: string[]) => ({ cards: ids.map((id) => app(id, "x")), total: ids.length, stuck: 0, nextOffset: ids.length, loading: false });
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  it("moveCardForDrag returns the SAME state object when the card is already in the target column", () => {
    const prev = { long: col(["a", "b"]), short: col(["c"]), empty: col([]) };
    expect(moveCardForDrag(prev, "a", "long", stageMap)).toBe(prev);
    expect(moveCardForDrag(prev, "a", "b", stageMap)).toBe(prev);
    expect(moveCardForDrag(prev, "nope", "short", stageMap)).toBe(prev);
  });

  it("moveCardForDrag moves above the hovered card, or to the top of a hovered column", () => {
    const prev = { long: col(["a", "b"]), short: col(["c"]), empty: col([]) };
    expect(moveCardForDrag(prev, "a", "c", stageMap).short.cards.map((x) => x.id)).toEqual(["a", "c"]);
    expect(moveCardForDrag(prev, "a", "empty", stageMap).empty.cards.map((x) => x.id)).toEqual(["a"]);
  });

  it("the ping-pong guard ignores an immediate move back to the column just left, but not a later one", () => {
    const last = { appId: "a", from: "long", at: 1000 };
    expect(isPingPong(last, "a", "long", 1010)).toBe(true);
    expect(isPingPong(last, "a", "long", 1200)).toBe(false);
    expect(isPingPong(last, "a", "empty", 1010)).toBe(false);
    expect(isPingPong(last, "z", "long", 1010)).toBe(false);
    expect(isPingPong(null, "a", "long", 1010)).toBe(false);
  });
});
