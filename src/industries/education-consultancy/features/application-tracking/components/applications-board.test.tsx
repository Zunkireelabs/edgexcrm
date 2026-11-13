// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import { ApplicationsBoard } from "./applications-board";
import { resolveBoardPlacement } from "../lib/board-placement";
import type { Application, ApplicationStage } from "@/types/database";

const stage = (o: Partial<ApplicationStage>): ApplicationStage =>
  ({ tenant_id: "t", slug: "s", created_at: "", updated_at: "", is_default: false, is_terminal: false, terminal_type: null, color: "#3b82f6", pipeline_id: "p1", ...o }) as ApplicationStage;

const stages = [
  stage({ id: "s1", name: "Applied", position: 0, is_default: true }),
  stage({ id: "s2", name: "Offer", position: 1 }),
  stage({ id: "s3", name: "Enrolled", position: 2, is_terminal: true, terminal_type: "won" }),
];
const app = (id: string, stage_id: string | null, extra: Partial<Application> = {}): Application =>
  ({
    id, lead_id: "l" + id, university_name: "Uni " + id, program_name: "Prog", stage_id, pipeline_id: null, status: "x",
    stage_changed_at: new Date(Date.now() - 31 * 86_400_000).toISOString(), assigned_to: null, countries: [], intake_term: null,
    offer_type: null, leads: { id: "l" + id, first_name: "A", last_name: "B", email: null }, ...extra,
  }) as unknown as Application;

const apps = [app("1", "s1"), app("2", "s3"), app("3", null)];
const pipelines = [{ id: "p1", is_default: true, position: 0 }];

function renderBoard(over: { isAdmin: boolean; canManage: boolean; apps?: Application[] }) {
  const list = over.apps ?? apps;
  const { placements } = resolveBoardPlacement(list, stages, pipelines);
  return render(
    <ApplicationsBoard
      stages={stages}
      applications={list}
      placements={placements}
      stageTotals={{}}
      pipelineId="p1"
      userId="u1"
      canManageApplications={over.canManage}
      isAdmin={over.isAdmin}
      onRefresh={vi.fn()}
      onAddToStage={vi.fn()}
      onEditStages={vi.fn()}
    />,
  );
}

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ApplicationsBoard", () => {
  it("collapses the finished stage by default and expands it on click, keeping the stored choice", async () => {
    renderBoard({ isAdmin: false, canManage: false });
    await waitFor(() => expect(screen.getAllByTestId("board-column")).toHaveLength(2));
    const slim = screen.getByTestId("slim-column");
    expect(slim).toHaveTextContent("Enrolled");
    fireEvent.click(slim);
    await waitFor(() => expect(screen.getAllByTestId("board-column")).toHaveLength(3));
    expect(localStorage.getItem("edgex-applications-board:u1:p1")).toContain("s3");
  });

  it("places a stage-less (null) app in the Start stage instead of dropping it", async () => {
    renderBoard({ isAdmin: false, canManage: false });
    await waitFor(() => screen.getAllByTestId("board-column"));
    const applied = screen.getAllByTestId("board-column")[0];
    expect(applied.querySelectorAll("[data-testid=application-card]")).toHaveLength(2);
  });

  it("counsellor (no manage, not admin): no +, no ··· menu, no add-stage", async () => {
    renderBoard({ isAdmin: false, canManage: false });
    await waitFor(() => screen.getAllByTestId("board-column"));
    expect(screen.queryByLabelText(/New application in/)).toBeNull();
    expect(screen.queryByLabelText(/options$/)).toBeNull();
    expect(screen.queryByLabelText("Add stage")).toBeNull();
  });

  it("admin: + , ··· menu and add-stage are present; the menu lists the Phase 1 actions", async () => {
    renderBoard({ isAdmin: true, canManage: true });
    await waitFor(() => screen.getAllByTestId("board-column"));
    expect(screen.getByLabelText("New application in Applied")).toBeInTheDocument();
    expect(screen.getByLabelText("Add stage")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Applied options"));
    for (const t of ["Track time in stage", "Collapse stage", "Hide stage", "Edit stages…", "Delete stage…"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("hiding a stage removes it and offers a restore", async () => {
    renderBoard({ isAdmin: true, canManage: true });
    await waitFor(() => screen.getAllByTestId("board-column"));
    fireEvent.click(screen.getByLabelText("Offer options"));
    fireEvent.click(screen.getByText("Hide stage"));
    expect(screen.getAllByTestId("board-column")).toHaveLength(1);
    fireEvent.click(screen.getByTitle("Show Offer again"));
    expect(screen.getAllByTestId("board-column")).toHaveLength(2);
  });

  it("deleting a stage that holds applications says to move them out first (no API call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { placements } = resolveBoardPlacement(apps, stages, pipelines);
    render(
      <ApplicationsBoard stages={stages} applications={apps} placements={placements} stageTotals={{ s1: 2 }} pipelineId="p1" userId="u1"
        canManageApplications isAdmin onRefresh={vi.fn()} onAddToStage={vi.fn()} onEditStages={vi.fn()} />,
    );
    await waitFor(() => screen.getAllByTestId("board-column"));
    fireEvent.click(screen.getByLabelText("Applied options"));
    fireEvent.click(screen.getByText("Delete stage…"));
    expect(await screen.findByText(/Move the 2 applications out of Applied first/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows 25 cards then 'Show N more', 25 per click", async () => {
    const many = Array.from({ length: 60 }, (_, i) => app("m" + i, "s1"));
    renderBoard({ isAdmin: false, canManage: false, apps: many });
    await waitFor(() => screen.getAllByTestId("board-column"));
    expect(screen.getAllByTestId("application-card")).toHaveLength(25);
    fireEvent.click(screen.getByText("Show 25 more"));
    expect(screen.getAllByTestId("application-card")).toHaveLength(50);
    fireEvent.click(screen.getByText("Show 10 more"));
    expect(screen.getAllByTestId("application-card")).toHaveLength(60);
  });

  it("age pill is neutral on the finished stage and red on an active one at 31d", async () => {
    renderBoard({ isAdmin: false, canManage: false });
    await waitFor(() => screen.getAllByTestId("board-column"));
    fireEvent.click(screen.getByTestId("slim-column"));
    const cols = await waitFor(() => {
      const c = screen.getAllByTestId("board-column");
      expect(c).toHaveLength(3);
      return c;
    });
    expect(cols[0].querySelector("[data-testid=age-pill]")?.className).toContain("text-[#b42318]");
    expect(cols[2].querySelector("[data-testid=age-pill]")?.className).not.toContain("b42318");
  });
});
