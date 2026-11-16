// @vitest-environment jsdom
//
// EDGEX-175: a non-assignee collaborator's Email/Phone inputs are disabled in
// edit mode (UI-only defense; the backend PATCH gate is the real enforcement).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { ContactCard } from "./contact-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
});

const lead = {
  id: "lead-1",
  first_name: "Asha",
  last_name: "K",
  email: "a@example.com",
  phone: "+977-9800000000",
  custom_fields: {},
  lead_type: "lead",
} as unknown as Lead;

const draft = {
  first_name: "Asha",
  last_name: "K",
  email: "a@example.com",
  phone: "+977-9800000000",
  city: "",
  nationality: "",
};

describe("ContactCard — restrictContactFields (EDGEX-175)", () => {
  it("disables Email/Phone inputs for a non-assignee collaborator", () => {
    render(
      <ContactCard
        lead={lead}
        isEditing
        draft={draft}
        industryId="it_agency"
        restrictContactFields
      />,
    );
    expect(screen.getByPlaceholderText("email@example.com")).toBeDisabled();
    expect(screen.getByPlaceholderText("+977 98...")).toBeDisabled();
  });

  it("leaves Email/Phone editable for the assignee/admin (restrictContactFields unset)", () => {
    render(
      <ContactCard
        lead={lead}
        isEditing
        draft={draft}
        industryId="it_agency"
      />,
    );
    expect(screen.getByPlaceholderText("email@example.com")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("+977 98...")).not.toBeDisabled();
  });
});
