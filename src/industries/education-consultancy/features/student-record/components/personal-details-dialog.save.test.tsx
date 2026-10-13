// @vitest-environment jsdom
//
// REGRESSION (client, Oct 13): "the qualification's institution address, the dates … show when we save, but after refreshing it's gone."
// Root cause: Save showed what was TYPED (copied into state) instead of what the server STORED. After Save the dialog must show the row
// the server returned, so a field that did not persist visibly reverts at once — and a field that did persist shows its stored value.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

// The dialog renders every section; on a busy machine (CI, or a build running alongside) that takes seconds, so wait generously.
vi.setConfig({ testTimeout: 30_000 });
const WAIT = { timeout: 15_000 };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

const LEAD = { id: "lead-1", custom_fields: {}, destinations: [], degree_level: "Undergraduate" };

function setup(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method: init?.method ?? "GET", body });
    return respond(body);
  }) as unknown as typeof fetch;
  const onLeadUpdate = vi.fn();
  render(
    <PersonalDetailsDialog lead={LEAD as unknown as Lead} open onOpenChange={() => {}} openInEditMode onLeadUpdate={onLeadUpdate} />,
  );
  // The dialog also GETs dropdown data when it opens; only the saves (PATCH) matter here.
  const saves = () => calls.filter((c) => c.method === "PATCH");
  return { calls, saves, onLeadUpdate };
}
const ok = (lead: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ data: { ...LEAD, ...lead } }) }) as Response;
const typeAddress = (value: string) =>
  fireEvent.change(screen.getAllByPlaceholderText("Enter address of institution")[0], { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

describe("Student Details > Save shows what the server stored", () => {
  it("sends the qualification address, and afterwards shows the STORED value", async () => {
    const { saves, onLeadUpdate } = setup(() => ok({ see_address: "Address as stored by the server" }));
    typeAddress("Address as typed");
    save();
    await screen.findByText("Address as stored by the server", {}, WAIT);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]).toMatchObject({ method: "PATCH", body: { see_address: "Address as typed" } });
    expect(screen.queryByText("Address as typed")).toBeNull();
    expect(onLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({ see_address: "Address as stored by the server" }));
    expect(toastSuccess).toHaveBeenCalledWith("Saved.");
  });

  it("a field the server did NOT store visibly reverts straight away (it no longer looks saved)", async () => {
    setup(() => ok({ see_address: null })); // the server dropped it
    typeAddress("Address that was never stored");
    save();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled(), WAIT);
    expect(screen.queryByText("Address that was never stored")).toBeNull();
  });

  it("a failed save keeps the dialog in edit mode with what was typed, and says so", async () => {
    setup(() => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    typeAddress("Typed but not saved");
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to save — nothing was changed. Your edits are still here, try again."), WAIT);
    expect((screen.getAllByPlaceholderText("Enter address of institution")[0] as HTMLInputElement).value).toBe("Typed but not saved");
  });

  it("sends nothing when nothing changed, and says so", async () => {
    const { saves } = setup(() => ok({}));
    save();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Nothing to save — no changes were made."), WAIT);
    expect(saves()).toHaveLength(0);
  });

  it("an older server that answers without the saved row still works (falls back to what was typed)", async () => {
    setup(() => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    typeAddress("Fallback address");
    save();
    await screen.findByText("Fallback address", {}, WAIT);
  });
});

describe("Student Details > nothing is labelled 'not saved' any more — every section saves", () => {
  it("shows no 'Not saved yet' badge on any section", () => {
    setup(() => ok({}));
    expect(screen.queryByText("Not saved yet")).toBeNull();
    expect(screen.queryByText("Score breakdown not saved yet")).toBeNull();
  });

  it("the header note says everything saves, and no longer talks about previews", () => {
    setup(() => ok({}));
    expect(screen.getByText(/Everything on this form saves/)).toBeInTheDocument();
    expect(screen.queryByText(/once their database update is live/)).toBeNull();
    expect(screen.queryByText(/are not stored yet/)).toBeNull();
  });
});
