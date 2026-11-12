// @vitest-environment jsdom
//
// EDGEX-155 Edit profile (layout="sections"): the Dialogs v1 form with a 200px section list. Opens at the first section with
// a consent gap (or the one a "Complete" link asked for), counts the gaps, and asks before throwing typed changes away.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

vi.setConfig({ testTimeout: 30_000 });
const WAIT = { timeout: 15_000 };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};

const originalFetch = global.fetch;
afterEach(() => { cleanup(); global.fetch = originalFetch; vi.clearAllMocks(); });

const LEAD = { id: "lead-1", first_name: "Aarav", last_name: "Shrestha", custom_fields: {}, destinations: [], degree_level: "Undergraduate" } as unknown as Lead;

function setup(opts: { missing?: string[]; requested?: string[]; onOpenChange?: (o: boolean) => void; onNavKey?: (d: "next" | "prev") => void } = {}) {
  const missing = opts.missing ?? ["Father's Name", "Passport Number", "Date of Birth"];
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/profile-completeness")) return { ok: true, status: 200, json: async () => ({ data: { complete: false, missing, total: 12, filled: 12 - missing.length } }) } as Response;
    return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
  }) as unknown as typeof fetch;
  render(
    <PersonalDetailsDialog
      lead={LEAD} open onOpenChange={opts.onOpenChange ?? (() => {})} openInEditMode layout="sections"
      missingBeforeApplications={opts.requested} onNavKey={opts.onNavKey}
    />,
  );
}
const body = () => screen.getByTestId("profile-section-body");

describe("Edit profile (sections layout)", () => {
  it("lists the sections and shows an amber count of consent gaps on each", async () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Profile sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.replace(/\d+$/, ""))).toEqual([
      "Personal", "Address", "Basic details", "Guardian", "Passport", "Study interest", "Academic", "Tests", "Work experience", "References", "Funding",
    ]);
    await waitFor(() => expect(within(nav).getByRole("button", { name: /Basic details/ })).toHaveTextContent("2"), WAIT);
    expect(within(nav).getByRole("button", { name: /Passport/ })).toHaveTextContent("1");
  });

  it("opens at the first section with a gap, and marks the fields the consent form needs", async () => {
    setup();
    await waitFor(() => expect(within(body()).getByRole("heading", { name: "Basic details" })).toBeInTheDocument(), WAIT);
    // Sentence-case labels, "Set …" placeholders.
    expect(body()).toHaveTextContent("Date of birth · needed for consent");
    expect(body()).toHaveTextContent("Father's name · needed for consent");
    expect(body()).not.toHaveTextContent("Mother's name · needed for consent");
    expect(screen.getByPlaceholderText("Set father's name")).toBeInTheDocument();
  });

  it("shows the header as one bar: title, then the name and fill count inline (no description line)", async () => {
    setup({ missing: [] });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Aarav Shrestha · 12 of 12 filled").tagName).toBe("SPAN");
  });

  it("opens at the section a 'Complete' link asked for", async () => {
    setup({ requested: ["Passport Number"] });
    await waitFor(() => expect(within(body()).getByRole("heading", { name: "Passport" })).toBeInTheDocument(), WAIT);
  });

  it("Study interest uses the full two-column grid like Basic details", async () => {
    setup({ missing: ["Field of Study"], requested: ["Field of Study"] });
    await waitFor(() => expect(within(body()).getByRole("heading", { name: "Study interest" })).toBeInTheDocument(), WAIT);
    expect(body().querySelector(".grid.sm\\:grid-cols-2")).not.toBeNull();
    expect(body().querySelector(".lg\\:grid-cols-3")).toBeNull();
  });

  it("header icon + title are left-aligned in a 44px bar and the icon is the page blue", async () => {
    setup({ missing: [] });
    const title = await screen.findByText("Edit profile");
    const bar = title.closest('[data-slot="dialog-header"]') as HTMLElement;
    expect(bar.className).toContain("justify-start");
    expect(bar.className).toContain("min-h-11");
    expect(bar.querySelector("svg")?.getAttribute("class")).toContain("text-[#266df0]");
  });

  it("other sections follow sentence case and 'Set …' placeholders too (Work experience)", async () => {
    setup({ missing: [] });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Profile sections" })).getByRole("button", { name: /Work experience/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Add work experience" }, WAIT));
    expect(within(body()).getByText("Name of institution")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Set name of institution")).toBeInTheDocument();
    expect(screen.queryByText("Name of Institution")).toBeNull();
  });

  it("falls back to Personal when nothing is missing", async () => {
    setup({ missing: [] });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    expect(within(body()).getByRole("heading", { name: "Personal" })).toBeInTheDocument();
  });

  it("closing with typed changes asks 'Discard your changes?' and keeps the dialog open until confirmed", async () => {
    const onOpenChange = vi.fn();
    setup({ missing: [], onOpenChange });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Aaravv" } });
    expect(screen.getByText("1 field changed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const box = await screen.findByRole("alertdialog");
    expect(within(box).getByText("Discard your changes?")).toBeInTheDocument();
    expect(box).toHaveTextContent("You edited 1 field on Aarav Shrestha. They won't be saved.");
    expect(within(box).getByText("Aarav Shrestha").tagName).toBe("B");
    expect(within(box).getByRole("button", { name: /^Discard/ })).toHaveTextContent("↵");
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole("button", { name: /^Discard/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closing with nothing typed just closes", async () => {
    const onOpenChange = vi.fn();
    setup({ missing: [], onOpenChange });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("J with typed changes asks first, then carries on to the next lead after Discard", async () => {
    const onNavKey = vi.fn();
    const onOpenChange = vi.fn();
    setup({ missing: [], onNavKey, onOpenChange });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Aaravv" } });
    fireEvent.keyDown(screen.getByRole("navigation", { name: "Profile sections" }), { key: "j" });
    const box = await screen.findByRole("alertdialog");
    expect(onNavKey).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole("button", { name: /^Discard/ }));
    expect(onNavKey).toHaveBeenCalledWith("next");
  });

  it("J with nothing typed does nothing (it never silently leaves the dialog)", async () => {
    const onNavKey = vi.fn();
    setup({ missing: [], onNavKey });
    await waitFor(() => expect(screen.getByText(/12 of 12 filled/)).toBeInTheDocument(), WAIT);
    fireEvent.keyDown(screen.getByRole("navigation", { name: "Profile sections" }), { key: "j" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onNavKey).not.toHaveBeenCalled();
  });
});
