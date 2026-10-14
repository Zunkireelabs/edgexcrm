// @vitest-environment jsdom
//
// Notes tab now also lists the calls and meetings logged for the lead (they lost their own tabs). Pins: they appear in the
// same list as the notes, in date order; the empty message only shows when there is truly nothing; and with no extras the
// tab behaves exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NotesTab } from "./notes-tab";
import type { LeadNote } from "@/types/database";

const note = (id: string, content: string, created_at: string): LeadNote =>
  ({ id, lead_id: "l1", user_id: "u1", user_email: "rep@x.com", content, created_at, updated_at: created_at }) as unknown as LeadNote;

const entry = (id: string, at: string, text: string) => ({ id, at, node: <div data-testid="extra">{text}</div> });

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response) as typeof fetch;
});
afterEach(cleanup);

const renderTab = (notes: LeadNote[], extraEntries?: ReturnType<typeof entry>[]) =>
  render(<NotesTab leadId="l1" notes={notes} onNotesChange={() => {}} currentUserId="u1" extraEntries={extraEntries} />);

describe("NotesTab — calls and meetings in the same list", () => {
  it("shows notes and call/meeting entries together, newest first", () => {
    renderTab(
      [note("n2", "Second note", "2026-10-09T10:00:00Z"), note("n1", "First note", "2026-10-03T10:00:00Z")],
      [entry("c1", "2026-10-06T10:00:00Z", "Call with Sita"), entry("m1", "2026-10-10T10:00:00Z", "Meeting at office")]
    );
    const text = document.body.textContent ?? "";
    const order = ["Meeting at office", "Second note", "Call with Sita", "First note"].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // already in the expected order
    expect(screen.getAllByTestId("extra")).toHaveLength(2);
  });

  it("when only calls/meetings exist, they show and the 'No notes yet' empty card does not", () => {
    renderTab([], [entry("c1", "2026-10-06T10:00:00Z", "Call with Sita")]);
    expect(screen.getByText("Call with Sita")).toBeInTheDocument();
    expect(screen.queryByText("No notes yet")).toBeNull();
  });

  it("with nothing at all, the empty message shows", () => {
    renderTab([], []);
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  it("without extras it is exactly the old behavior (notes only, in the order given)", () => {
    renderTab([note("n2", "Newer note", "2026-10-09T10:00:00Z"), note("n1", "Older note", "2026-10-01T10:00:00Z")]);
    expect(screen.queryAllByTestId("extra")).toHaveLength(0);
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Newer note")).toBeLessThan(text.indexOf("Older note"));
  });
});
