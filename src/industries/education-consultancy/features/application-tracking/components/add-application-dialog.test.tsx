// @vitest-environment jsdom
//
// EDGEX-154: Add application is a Dialogs v1 form dialog (was a side sheet) with an "Add another" toggle.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-application-reference-data", () => ({
  useApplicationReferenceData: () => ({
    agents: [], partnerColleges: [], countries: [], intakeMonths: [], intakeYears: [], createPartnerCollege: vi.fn(), programsByUniversity: {},
    fetchPrograms: vi.fn(), createProgram: vi.fn(), fetchDistinctProgramNames: vi.fn(),
  }),
  getCollegeSuggestions: () => [],
}));
vi.mock("@/hooks/use-edu-taxonomy", () => ({ useEduTaxonomy: () => ({ studyLevels: [], fieldsOfStudy: [] }) }));
vi.mock("../hooks/use-application-status-options", () => ({ useApplicationStatusOptions: () => ({ stages: [{ id: "s1", name: "Preparing", is_default: true }], loading: false }) }));

import { AddApplicationDialog } from "./add-application-dialog";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_u: string, init?: { method?: string }) =>
    init?.method === "POST" ? { ok: true, status: 201, json: async () => ({ data: {} }) } : { ok: true, status: 200, json: async () => ({ data: { destinations: [] } }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderDialog() {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(<AddApplicationDialog open onOpenChange={onOpenChange} leadId="lead-1" stages={[]} onSaved={onSaved} leadName="Aarav Shrestha" />);
  return { onOpenChange, onSaved };
}
const fill = () => {
  fireEvent.change(document.getElementById("app-university")!, { target: { value: "University of Melbourne" } });
  fireEvent.change(document.getElementById("app-program")!, { target: { value: "Bachelor of Nursing" } });
};
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("AddApplicationDialog", () => {
  it("is a dialog (not a side sheet), with the same API call as before", async () => {
    const { onOpenChange, onSaved } = renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add application" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add application/ })).toBeDisabled(); // university + program are required
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Add application/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe("/api/v1/leads/lead-1/applications");
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ university_name: "University of Melbourne", program_name: "Bachelor of Nursing", stage_id: "s1" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false); // closes after a save by default
  });

  it("'Add another' on: saves, stays open and clears the form for the next one", async () => {
    const { onOpenChange, onSaved } = renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: "Add another" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Add application/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((document.getElementById("app-university") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("app-program") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("switch", { name: "Add another" })).toHaveAttribute("aria-checked", "true");
  });
});
