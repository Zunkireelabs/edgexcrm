// @vitest-environment jsdom
//
// Client request (Oct 13): Student Details should ask "do you want to save this?" and warn before typed changes are thrown away.
//  - Save with changes asks first, and sends NOTHING until the user confirms.
//  - Cancel / the X / Esc with unsaved changes asks before discarding; with no changes it just closes (no pointless question).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

// The dialog renders every section; on a busy machine that takes seconds, so wait generously.
vi.setConfig({ testTimeout: 30_000 });
const WAIT = { timeout: 15_000 };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: vi.fn(), error: vi.fn() } }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

const LEAD = { id: "lead-1", custom_fields: {}, destinations: [], degree_level: "Undergraduate" };

function setup() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method: init?.method ?? "GET", body });
    return { ok: true, status: 200, json: async () => ({ data: { ...LEAD, ...body } }) } as Response;
  }) as unknown as typeof fetch;
  const onOpenChange = vi.fn();
  render(<PersonalDetailsDialog lead={LEAD as unknown as Lead} open onOpenChange={onOpenChange} openInEditMode />);
  return { saves: () => calls.filter((c) => c.method === "PATCH"), onOpenChange };
}

const addressInput = () => screen.getAllByPlaceholderText("Enter address of institution")[0] as HTMLInputElement;
const typeAddress = (value: string) => fireEvent.change(addressInput(), { target: { value } });
const clickHeader = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const box = () => screen.getByRole("alertdialog");

describe("Student Details > 'Save these changes?'", () => {
  it("asks first and sends nothing until the user confirms", async () => {
    const { saves } = setup();
    typeAddress("Thapagaun");
    clickHeader(/^Save$/);

    expect(within(box()).getByText("Save these changes?")).toBeInTheDocument();
    expect(saves()).toHaveLength(0);

    fireEvent.click(within(box()).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(saves()).toHaveLength(1), WAIT);
    expect(saves()[0].body).toMatchObject({ see_address: "Thapagaun" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Saved."), WAIT);
  });

  it("'Keep editing' sends nothing and leaves what was typed in place", () => {
    const { saves } = setup();
    typeAddress("Thapagaun");
    clickHeader(/^Save$/);
    fireEvent.click(within(box()).getByRole("button", { name: /keep editing/i }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(saves()).toHaveLength(0);
    expect(addressInput().value).toBe("Thapagaun");
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeInTheDocument(); // still editing
  });

  it("does not ask when nothing was changed — it just says so", async () => {
    const { saves } = setup();
    clickHeader(/^Save$/);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Nothing to save — no changes were made."), WAIT);
    expect(saves()).toHaveLength(0);
  });
});

describe("Student Details > 'Discard your changes?'", () => {
  it("Cancel with typed changes asks first; 'Keep editing' keeps them", () => {
    setup();
    typeAddress("Thapagaun");
    clickHeader(/^Cancel$/);

    expect(within(box()).getByText("Discard your changes?")).toBeInTheDocument();
    fireEvent.click(within(box()).getByRole("button", { name: /keep editing/i }));
    expect(addressInput().value).toBe("Thapagaun");
  });

  it("Cancel then 'Discard' leaves edit mode and drops the typed value", () => {
    const { saves, onOpenChange } = setup();
    typeAddress("Thapagaun");
    clickHeader(/^Cancel$/);
    fireEvent.click(within(box()).getByRole("button", { name: /^Discard$/ }));

    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeInTheDocument();
    expect(saves()).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalled(); // the pop-up itself stays open, in read-only mode
  });

  it("Cancel with no changes leaves edit mode without asking", () => {
    setup();
    clickHeader(/^Cancel$/);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeInTheDocument();
  });

  it("closing the pop-up (X) with typed changes asks first, and only closes after 'Discard'", () => {
    const { onOpenChange } = setup();
    typeAddress("Thapagaun");
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));

    expect(within(box()).getByText("Discard your changes?")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(within(box()).getByRole("button", { name: /^Discard$/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closing the pop-up (X) with no changes closes straight away", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
