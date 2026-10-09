// @vitest-environment jsdom
//
// Guard for the Details box on the lead page.
//
// History: PR #614's review made this box keep SHOWING Residence Country and Preferred Contact on the
// education page, because the Student Details pop-up was then the only place to edit them and hiding the
// box had made them invisible. The client has since asked for both to go from the education flow (Residence
// Country is replaced by the address Country in Student Details; Preferred Contact is dropped to cut counselor
// typing), and the pop-up no longer edits them — so on education the box now shows only the College, and
// disappears when there is none. Other industries are unchanged: the box is still the only place they show /
// edit Residence Country, Preferred Contact and the Entity (their Edit button enters inline mode).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead, TenantEntity } from "@/types/database";
import { KeyInfoSection } from "./key-info-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const lead = {
  id: "lead-1",
  first_name: "Asha",
  last_name: "K",
  email: "a@example.com",
  phone: "+977-9800000000",
  country: "Nepal",
  preferred_contact_method: "phone",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  custom_fields: {},
  lead_type: "lead",
} as unknown as Lead;
const college = { id: "e1", name: "Arden University", description: null } as unknown as TenantEntity;

function renderSection(industryId: string, extra: Record<string, unknown> = {}) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch;
  render(
    <KeyInfoSection
      lead={lead}
      stages={[]}
      stageId={null}
      assignedTo=""
      teamMembers={[]}
      isAdmin
      onStageChange={() => {}}
      onAssignmentChange={() => {}}
      industryId={industryId}
      entity={college}
      {...extra}
    />,
  );
  const details = screen.queryByRole("button", { name: /details/i });
  if (details) fireEvent.click(details);
}

describe("KeyInfoSection — Details box", () => {
  it("education: shows the College but no longer Residence Country or Preferred Contact", () => {
    renderSection("education_consultancy");
    expect(screen.getByText("Arden University")).toBeInTheDocument();
    expect(screen.queryByText("Residence Country")).not.toBeInTheDocument();
    expect(screen.queryByText("Preferred Contact")).not.toBeInTheDocument();
    // The values are still on the lead — they are just not displayed on the education page.
    expect(screen.queryByText("Nepal")).not.toBeInTheDocument();
  });

  it("education with no College: the Details box is not shown at all (nothing left to show)", () => {
    renderSection("education_consultancy", { entity: null });
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
    expect(screen.queryByText("No details yet. Use Edit to add.")).not.toBeInTheDocument();
  });

  it("other industries: Residence Country and Preferred Contact are editable inline", () => {
    renderSection("it_agency", {
      isEditing: true,
      draft: { country: "Nepal", preferred_contact_method: "phone" },
      onDraftChange: () => {},
    });
    expect(screen.getByText("Residence Country")).toBeInTheDocument();
    expect(screen.getByText("Preferred Contact")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
  });

  it("education: drops only the duplicate Created / Last Updated rows (the contact card shows them)", () => {
    renderSection("education_consultancy");
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByText("Last Updated")).not.toBeInTheDocument();
  });

  it("other industries keep Created / Last Updated", () => {
    renderSection("it_agency");
    expect(screen.getByText("Residence Country")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Last Updated")).toBeInTheDocument();
  });
});
