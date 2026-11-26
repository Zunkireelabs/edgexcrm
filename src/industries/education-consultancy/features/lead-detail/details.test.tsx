// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import type { Lead } from "@/types/database";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/use-edu-taxonomy", () => ({ useEduTaxonomy: () => ({ destinations: [], fieldsOfStudy: [], studyLevels: [] }) }));

import { DetailsList } from "./details";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes("/collaborators") ? { data: { collaborators: [{ user_id: "u9", email: "amit@x.com", name: "Amit Rawal" }] } } : { data: {} }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const person = { user_id: "u1", email: "asmita@x.com", name: "Asmita" };
function props(over: Partial<ComponentProps<typeof DetailsList>> = {}): ComponentProps<typeof DetailsList> {
  return {
    lead: { id: "lead-1", assigned_to: "u1", tags: [], destinations: [], on_hold: false } as unknown as Lead,
    currentUserId: "u2", memberNames: { u1: "Asmita" }, branchName: "KTM", sourceName: "Google", intake: null,
    canEdit: true, canPickCounsellor: true, isAdmin: true, counsellorOptions: [person], roster: [person],
    onAssign: vi.fn(), onPatch: vi.fn(async () => true), hideStudy: true,
    ...over,
  };
}
const collaboratorFetches = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/collaborators")).length;

describe("DetailsList parts", () => {
  it('"owners" is its own list with just Assignee and Collaborators', async () => {
    render(<DetailsList {...props()} part="owners" />);
    const list = screen.getByRole("list", { name: "Assignee and collaborators" });
    expect(within(list).getByText("Assignee")).toBeInTheDocument();
    expect(within(list).getByText("Collaborators")).toBeInTheDocument();
    expect(within(list).getByText("Asmita")).toBeInTheDocument();
    await waitFor(() => expect(within(list).getByText("Amit Rawal")).toBeInTheDocument());
    expect(screen.queryByText("Branch")).not.toBeInTheDocument();
    expect(screen.queryByText("Source")).not.toBeInTheDocument();
  });

  it('"rest" is the Details list without Assignee and Collaborators, and does not load collaborators', () => {
    render(<DetailsList {...props()} part="rest" />);
    const list = screen.getByRole("list", { name: "Details" });
    expect(within(list).getByText("Branch")).toBeInTheDocument();
    expect(within(list).getByText("Source")).toBeInTheDocument();
    expect(within(list).getByText("KTM")).toBeInTheDocument();
    expect(screen.queryByText("Assignee")).not.toBeInTheDocument();
    expect(screen.queryByText("Collaborators")).not.toBeInTheDocument();
    expect(collaboratorFetches()).toBe(0);
  });

  it("with no part given it is the whole list, exactly as before", async () => {
    render(<DetailsList {...props()} />);
    const list = screen.getByRole("list", { name: "Details" });
    for (const label of ["Assignee", "Collaborators", "Branch", "Source"]) expect(within(list).getByText(label)).toBeInTheDocument();
    await waitFor(() => expect(collaboratorFetches()).toBe(1));
  });

  it("the two blocks together show each row exactly once", () => {
    render(<><DetailsList {...props()} part="owners" /><DetailsList {...props()} part="rest" /></>);
    for (const label of ["Assignee", "Collaborators", "Branch", "Source"]) expect(screen.getAllByText(label)).toHaveLength(1);
  });

  it("an unassigned lead still shows the Assignee row, as Unassigned", () => {
    render(<DetailsList {...props({ lead: { id: "lead-1", assigned_to: null, tags: [], destinations: [], on_hold: false } as unknown as Lead })} part="owners" />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
