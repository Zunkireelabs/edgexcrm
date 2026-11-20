// @vitest-environment jsdom
//
// EDGEX-154: the lead page's "Check in" dialog over POST /api/v1/leads/:id/check-in.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};

import { LeadCheckInDialog, guideLine, type CheckInTriage } from "./lead-check-in";

const PEOPLE = [{ value: "u-farhan", label: "Farhan Ali" }, { value: "u-sita", label: "Sita Karki" }];
const triage = (currentSlug: string | null, o: Partial<CheckInTriage> = {}): CheckInTriage => ({
  currentSlug, leadExecs: [{ value: "u-exec", label: "Lead Exec One" }], counselors: [{ value: "u-farhan", label: "Farhan Ali" }], holderName: "Farhan Ali", ...o,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { checked_in: true } }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); toastSuccess.mockClear(); toastError.mockClear(); });

function renderDialog(t: CheckInTriage | null, onSaved = vi.fn(), onOpenChange = vi.fn()) {
  render(<LeadCheckInDialog open onOpenChange={onOpenChange} leadId="lead-1" leadName="Aarav Shrestha" meetWithOptions={PEOPLE} triage={t} onSaved={onSaved} />);
  return { onSaved, onOpenChange };
}
const pick = async (combo: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: combo }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(option) }));
};

describe("LeadCheckInDialog", () => {
  it("education, lead in Qualified: Reason + Meeting with + Assign to + the guide line; no Move (the server only moves un-triaged leads)", () => {
    renderDialog(triage("qualified"));
    expect(screen.getByRole("heading", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Meeting with" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assign to" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Move to" })).toBeNull();
    expect(screen.getByText("Records a visit now. Assign is optional.")).toBeInTheDocument();
  });

  it("a lead not yet in Qualified can be moved (Move to), and Assign only appears once a stage is chosen", () => {
    renderDialog(triage("new"));
    expect(screen.getByRole("combobox", { name: "Move to" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Assign to" })).toBeNull();
  });

  it("a lead already in Prospects / Applications: neither Assign nor Move (the server ignores them there)", () => {
    renderDialog(triage("prospects"));
    expect(screen.queryByRole("combobox", { name: "Move to" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Assign to" })).toBeNull();
    cleanup();
    renderDialog(triage("applications"));
    expect(screen.queryByRole("combobox", { name: "Move to" })).toBeNull();
  });

  it("guide line matches what is on screen: both / only Assign / only Move / neither", () => {
    expect(guideLine(true, true)).toBe("Records a visit now. Assign and Move are optional.");
    renderDialog(triage("new")); // Move only (Assign waits for a stage)
    expect(screen.getByText("Records a visit now. Move is optional.")).toBeInTheDocument();
    cleanup();
    renderDialog(triage("qualified")); // Assign only
    expect(screen.getByText("Records a visit now. Assign is optional.")).toBeInTheDocument();
    cleanup();
    renderDialog(triage("prospects")); // neither
    expect(screen.getByText("Records a visit now.")).toBeInTheDocument();
    expect(screen.queryByText(/(is|are) optional/)).toBeNull();
  });

  it("non-education (no triage): only Reason and Meeting with, and no Assign / Move line", () => {
    renderDialog(null);
    expect(screen.queryByText(/Assign and Move are optional/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Assign to" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Meeting with" })).toBeInTheDocument();
  });

  it("posts reason, meet_with_id and assign_to_id to the check-in endpoint, toasts, reports triaged, and closes", async () => {
    const { onSaved, onOpenChange } = renderDialog(triage("qualified"));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Document submission" } });
    await pick("Meeting with", "Sita Karki");
    await pick("Assign to", "Lead Exec One");
    fireEvent.click(screen.getByRole("button", { name: /^Check in/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/leads/lead-1/check-in");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ reason: "Document submission", meet_with_id: "u-sita", assign_to_id: "u-exec", move_to_stage: null });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Check-in recorded"));
    expect(onSaved).toHaveBeenCalledWith({ triaged: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a bare visit sends nothing optional and is not 'triaged'", async () => {
    const { onSaved } = renderDialog(triage("qualified"));
    fireEvent.click(screen.getByRole("button", { name: /^Check in/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ triaged: false }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ meet_with_id: null, assign_to_id: null, move_to_stage: null });
  });

  it("a refusal (e.g. the server's GPA rule) shows the server's sentence and keeps the dialog open", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: { message: "Validation failed", details: { academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."] } } }) });
    const { onSaved, onOpenChange } = renderDialog(triage("qualified"));
    fireEvent.click(screen.getByRole("button", { name: /^Check in/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Add the student's highest qualification (%/GPA) before moving to Prospects."));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
