// @vitest-environment jsdom

// EDGEX-141 Phase 5: the board below md (ApplicationsBoard phone=true -> PhoneBoard).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }) }));

import { ApplicationsBoard } from "./applications-board";
import { LONG_PRESS_MS } from "./application-card";
import { assembleBoardPayload, buildBoardIndex, firstPageIds, type IndexRow } from "../lib/board-index";
import { moveCardBetweenColumns, openingStageId, stripOrder } from "../lib/phone-board";
import type { Application, ApplicationStage } from "@/types/database";

const stage = (o: Partial<ApplicationStage>): ApplicationStage =>
  ({ tenant_id: "t", slug: "s", created_at: "", updated_at: "", is_default: false, is_terminal: false, terminal_type: null, color: "#3b82f6", pipeline_id: "p1", ...o }) as ApplicationStage;

// Deliberately out of position order in the array: the strip must follow `position` + finished-last.
const stages = [
  stage({ id: "s0", name: "Need to start", position: 0, is_default: true }),
  stage({ id: "s1", name: "Applied", position: 1 }),
  stage({ id: "s2", name: "Offer", position: 2 }),
  stage({ id: "s3", name: "Enrolled", position: 3, is_terminal: true, terminal_type: "won" }),
  stage({ id: "s4", name: "Withdrawn", position: 4, is_terminal: true, terminal_type: "lost" }),
];
const app = (id: string, stage_id: string | null, extra: Partial<Application> = {}): Application =>
  ({
    id, lead_id: "l" + id, university_name: "Uni " + id, program_name: "Prog", stage_id, pipeline_id: null, status: "x",
    stage_changed_at: new Date(Date.now() - 31 * 86_400_000).toISOString(), created_at: "2026-01-01", updated_at: "2026-01-01",
    application_deadline: null, assigned_to: null, countries: [], intake_term: null,
    offer_type: null, leads: { id: "l" + id, first_name: "Sita", last_name: id, email: null }, ...extra,
  }) as unknown as Application;

// s0 empty -> the board opens on Applied (the first stage with applications).
const apps = [app("1", "s1"), app("2", "s1"), app("3", "s2"), app("4", "s3")];
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

function renderBoard(over: { canManage: boolean; phone: boolean }) {
  const { board, fetchPage } = serverFor(apps);
  const onRefresh = vi.fn();
  const utils = render(
    <ApplicationsBoard
      stages={stages}
      board={board}
      fetchPage={fetchPage}
      stageTotals={{}}
      pipelineId="p1"
      userId="u1"
      canManageApplications={over.canManage}
      isAdmin={over.canManage}
      onRefresh={onRefresh}
      onAddToStage={vi.fn()}
      onEditStages={vi.fn()}
      phone={over.phone}
    />,
  );
  return { ...utils, onRefresh, board, fetchPage };
}

const fetchMock = vi.fn();
beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  pushMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const pillNames = () => screen.getAllByTestId("stage-pill").map((p) => p.firstChild?.nextSibling?.textContent);
const pillCount = (name: string) =>
  within(screen.getAllByTestId("stage-pill").find((p) => p.textContent?.startsWith(name))!).getByTestId("stage-pill-count").textContent;
const columnOf = (id: string) => document.querySelector<HTMLElement>(`[data-phone-column="${id}"]`)!;

describe("phone board vs desktop board", () => {
  it("below md: renders the stage strip and phone columns, no desktop columns, no drag (cards disabled)", async () => {
    renderBoard({ canManage: true, phone: true });
    await screen.findByTestId("stage-strip");
    expect(screen.queryByTestId("applications-board")).toBeNull();
    expect(screen.queryAllByTestId("board-column")).toHaveLength(0);
    expect(screen.queryAllByTestId("slim-column")).toHaveLength(0);
    const cards = screen.getAllByTestId("application-card");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).toHaveAttribute("aria-disabled", "true");
    // no column header on phone: the strip replaces it
    expect(screen.queryAllByTestId("count-pill")).toHaveLength(0);
  });

  it("md and up: unchanged desktop board (columns, slim finished, draggable cards for managers), no strip", async () => {
    renderBoard({ canManage: true, phone: false });
    await waitFor(() => expect(screen.getAllByTestId("board-column").length).toBeGreaterThan(0));
    expect(screen.getByTestId("applications-board")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-strip")).toBeNull();
    expect(screen.queryAllByTestId("card-move")).toHaveLength(0);
    expect(screen.getAllByTestId("application-card")[0]).toHaveAttribute("aria-disabled", "false");
  });
});

describe("stage strip", () => {
  it("orders active stages, then the Finished divider, then finished stages; counts equal the desktop column counts", async () => {
    renderBoard({ canManage: false, phone: true });
    await screen.findByTestId("stage-strip");
    expect(pillNames()).toEqual(["Need to start", "Applied", "Offer", "Enrolled", "Withdrawn"]);
    const strip = screen.getByTestId("stage-strip");
    const kids = [...strip.children].map((el) => (el.getAttribute("data-testid") === "strip-divider" ? "|" : el.getAttribute("data-stage-pill")));
    expect(kids).toEqual(["s0", "s1", "s2", "|", "s3", "s4"]);
    const phone = Object.fromEntries(["Need to start", "Applied", "Offer", "Enrolled", "Withdrawn"].map((n) => [n, pillCount(n)]));
    cleanup();

    renderBoard({ canManage: false, phone: false });
    await waitFor(() => screen.getAllByTestId("board-column"));
    const desktop: Record<string, string | null> = {};
    for (const col of screen.getAllByTestId("board-column")) desktop[col.querySelector("h3")!.textContent!] = col.querySelector("[data-testid=count-pill]")!.textContent;
    for (const slim of screen.getAllByTestId("slim-column")) desktop[slim.textContent!.replace(/^\d+/, "")] = slim.textContent!.match(/^\d+/)![0];
    expect(phone).toEqual(desktop);
    expect(phone).toEqual({ "Need to start": "0", Applied: "2", Offer: "1", Enrolled: "1", Withdrawn: "0" });
  });

  it("opens on the first stage that has applications; finished pills are outlined", async () => {
    renderBoard({ canManage: false, phone: true });
    await screen.findByTestId("stage-strip");
    const on = screen.getAllByTestId("stage-pill").filter((p) => p.getAttribute("aria-selected") === "true");
    expect(on).toHaveLength(1);
    expect(on[0]).toHaveTextContent("Applied");
    const enrolled = screen.getAllByTestId("stage-pill").find((p) => p.textContent?.startsWith("Enrolled"))!;
    expect(enrolled.className).toContain("shadow-[inset_0_0_0_1px_var(--ds-border)]");
  });

  it("tapping a finished pill makes it current and lazy-loads that column (no New application row, no age pills)", async () => {
    const { fetchPage } = renderBoard({ canManage: true, phone: true });
    await screen.findByTestId("stage-strip");
    expect(fetchPage).not.toHaveBeenCalledWith("s3", 0);
    fireEvent.click(screen.getAllByTestId("stage-pill").find((p) => p.textContent?.startsWith("Enrolled"))!);
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith("s3", 0));
    await waitFor(() => expect(columnOf("s3").querySelectorAll("[data-testid=application-card]")).toHaveLength(1));
    expect(within(columnOf("s3")).queryByText("New application")).toBeNull();
    expect(columnOf("s3").querySelector("[data-testid=age-pill]")).toBeNull();
    expect(within(columnOf("s1")).getByText("New application")).toBeInTheDocument();
  });

  it("hides entirely when every stage is 0 (the no-results state takes over)", async () => {
    const empty = serverFor([]);
    render(
      <ApplicationsBoard stages={stages} board={empty.board} fetchPage={empty.fetchPage} stageTotals={{}} pipelineId="p1" userId="u1"
        canManageApplications isAdmin onRefresh={vi.fn()} onAddToStage={vi.fn()} onEditStages={vi.fn()} phone />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId("stage-strip")).toBeNull();
    expect(screen.queryByTestId("phone-board")).toBeNull();
  });
});

describe("Move to stage sheet", () => {
  it("read-only users: no ⋯, long-press does nothing, a tap opens the detail", async () => {
    renderBoard({ canManage: false, phone: true });
    await screen.findByTestId("stage-strip");
    expect(screen.queryAllByTestId("card-move")).toHaveLength(0);
    vi.useFakeTimers();
    const card = within(columnOf("s1")).getAllByTestId("application-card")[0];
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 50));
    fireEvent.pointerUp(card);
    fireEvent.click(card);
    expect(screen.queryByTestId("move-stage-sheet")).toBeNull();
    expect(pushMock).toHaveBeenCalledWith(`/applications/${card.getAttribute("data-app-id")}`);
  });

  it("admin: ⋯ opens the sheet (active stages, Finished group, current ticked); picking PATCHes, removes the card, updates counts, toasts Undo", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { status: "offer" } }) });
    const { onRefresh } = renderBoard({ canManage: true, phone: true });
    await screen.findByTestId("stage-strip");
    const first = within(columnOf("s1")).getAllByTestId("application-card")[0];
    const appId = first.getAttribute("data-app-id")!;
    fireEvent.click(within(first).getByTestId("card-move"));

    const sheet = await screen.findByTestId("move-stage-sheet");
    expect(sheet).toHaveTextContent("Move to stage");
    expect(sheet).toHaveTextContent(`Sita ${appId} · Uni ${appId}`);
    const options = within(sheet).getAllByRole("option");
    expect(options.map((o) => o.textContent?.replace(/\d+$/, ""))).toEqual(["Need to start", "Applied", "Offer", "Enrolled", "Withdrawn"]);
    expect(within(sheet).getByText("Finished")).toBeInTheDocument();
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1].className).toContain("h-8"); // ITEM row; the sheet body lifts it to 44px

    fireEvent.click(options[2]); // Offer
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/applications/${appId}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ stage_id: "s2" }) }));
    await waitFor(() => expect(within(columnOf("s1")).queryAllByTestId("application-card").map((c) => c.getAttribute("data-app-id"))).not.toContain(appId));
    expect(columnOf("s2").querySelector(`[data-app-id="${appId}"]`)).not.toBeNull();
    expect(pillCount("Applied")).toBe("1");
    expect(pillCount("Offer")).toBe("2");
    expect(onRefresh).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith("Moved to Offer", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));

    // Undo PATCHes back to Applied.
    const undo = toastMock.success.mock.calls[0][1].action.onClick as () => void;
    act(() => undo());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/applications/${appId}`);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ stage_id: "s1" }) });
    await waitFor(() => expect(pillCount("Applied")).toBe("2"));
    expect(pillCount("Offer")).toBe("1");
    expect(toastMock.success).toHaveBeenLastCalledWith("Moved back to Applied");
  });

  it("a failed PATCH keeps the card and its counts, and toasts an error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderBoard({ canManage: true, phone: true });
    await screen.findByTestId("stage-strip");
    const first = within(columnOf("s1")).getAllByTestId("application-card")[0];
    const appId = first.getAttribute("data-app-id")!;
    fireEvent.click(within(first).getByTestId("card-move"));
    fireEvent.click(within(await screen.findByTestId("move-stage-sheet")).getAllByRole("option")[2]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(columnOf("s1").querySelector(`[data-app-id="${appId}"]`)).not.toBeNull();
    expect(pillCount("Applied")).toBe("2");
    expect(pillCount("Offer")).toBe("1");
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("picking the current stage does nothing", async () => {
    renderBoard({ canManage: true, phone: true });
    await screen.findByTestId("stage-strip");
    fireEvent.click(within(within(columnOf("s1")).getAllByTestId("application-card")[0]).getByTestId("card-move"));
    fireEvent.click(within(await screen.findByTestId("move-stage-sheet")).getAllByRole("option")[1]);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin long-press (500ms) opens the sheet and the release does not open the detail; a short press or a swipe doesn't", async () => {
    renderBoard({ canManage: true, phone: true });
    await screen.findByTestId("stage-strip");
    vi.useFakeTimers();
    const card = within(columnOf("s1")).getAllByTestId("application-card")[0];

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 100));
    fireEvent.pointerUp(card);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("move-stage-sheet")).toBeNull();

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { clientX: 40, clientY: 12 }); // a swipe
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 50));
    expect(screen.queryByTestId("move-stage-sheet")).toBeNull();

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(screen.getByTestId("move-stage-sheet")).toBeInTheDocument();
    fireEvent.click(card); // the release's click
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("phone-board helpers", () => {
  it("stripOrder keeps position order and puts finished stages last", () => {
    const { active, finished } = stripOrder(stages);
    expect(active.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(finished.map((s) => s.id)).toEqual(["s3", "s4"]);
  });
  it("openingStageId = first stage with applications, else the first stage", () => {
    expect(openingStageId(stages, (id) => ({ s2: 3 })[id] ?? 0)).toBe("s2");
    expect(openingStageId(stages, () => 0)).toBe("s0");
    expect(openingStageId([], () => 0)).toBeNull();
  });
  it("moveCardBetweenColumns: source loses the card + count (+ stuck), target gains it at the top", () => {
    const a = app("a", "s1");
    const cols = {
      s1: { cards: [a, app("b", "s1")], total: 30, stuck: 5, nextOffset: 2, loading: false },
      s2: { cards: [app("c", "s2")], total: 4, stuck: 0, nextOffset: 1, loading: false },
    };
    const next = moveCardBetweenColumns(cols, { appId: "a", from: "s1", to: "s2", moved: { ...a, stage_id: "s2" }, fromStage: stages[1] });
    expect(next.s1).toMatchObject({ total: 29, stuck: 4, nextOffset: 1 });
    expect(next.s1.cards.map((c) => c.id)).toEqual(["b"]);
    expect(next.s2).toMatchObject({ total: 5, nextOffset: 1 });
    expect(next.s2.cards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(moveCardBetweenColumns(cols, { appId: "a", from: "s1", to: "s1", moved: a })).toBe(cols);
  });
});
