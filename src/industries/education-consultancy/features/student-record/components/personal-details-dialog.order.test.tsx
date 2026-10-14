// @vitest-environment jsdom
//
// Client request (Oct 13): Study Interest is the information staff need first, so in the Student Details pop-up it sits right under the
// contact + address card — not after the long Basic Details / Guardian / Passport block.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const LEAD = { id: "lead-1", custom_fields: {}, destinations: [], degree_level: "Undergraduate" };

const isBefore = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe.each([
  ["edit mode", true],
  ["read-only mode", false],
])("Student Details section order (%s)", (_name, editing) => {
  it("puts Study Interest right under the contact + address card, before Basic Details, Guardian and Passport", () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }) as Response) as unknown as typeof fetch;
    render(<PersonalDetailsDialog lead={LEAD as unknown as Lead} open onOpenChange={() => {}} openInEditMode={editing} />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.slice(0, 4)).toEqual(["Personal Information", "Study Interest", "Personal Details", "Academic Information"]);

    const study = screen.getByRole("heading", { name: "Study Interest" });
    expect(isBefore(screen.getAllByText("Address", { selector: "p" })[0], study)).toBe(true); // after the address
    expect(isBefore(study, screen.getByText("Basic Details"))).toBe(true); // before Basic Details
  });
});
