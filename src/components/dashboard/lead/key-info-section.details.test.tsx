// @vitest-environment jsdom
//
// Guard (PR #614 review): the Details box must keep SHOWING Residence Country, Preferred Contact and the
// College on the education lead page (hiding the box once made them invisible). Editing them on
// education happens in the Student Details pop-up — that is guarded by
// student-record/components/consent-fields-reachable.test.tsx. Inline editing here is for the other
// industries, whose Edit button really does enter inline mode.
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
  fireEvent.click(screen.getByRole("button", { name: /details/i }));
}

describe("KeyInfoSection — Details box", () => {
  it("education: shows Residence Country, Preferred Contact and the College", () => {
    renderSection("education_consultancy");
    expect(screen.getByText("Residence Country")).toBeInTheDocument();
    expect(screen.getByText("Nepal")).toBeInTheDocument();
    expect(screen.getByText("Preferred Contact")).toBeInTheDocument();
    expect(screen.getByText("Arden University")).toBeInTheDocument();
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
