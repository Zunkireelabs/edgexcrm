// @vitest-environment jsdom
//
// EDGEX-175 gap found in manual QA: for education_consultancy tenants, the page's single Edit
// button opens this dialog (not ContactCard's inline edit), so a non-admin, non-assignee
// collaborator could still type into Email/Phone here and get a confusing generic-failure toast
// from the backend's 403 instead of the fields simply being disabled.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function renderDialog(restrictContactFields: boolean) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })) as unknown as typeof fetch;
  render(
    <PersonalDetailsDialog
      lead={{ id: "lead-1", custom_fields: {}, destinations: [], first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", phone: "+977-9800000000" } as unknown as Lead}
      open
      onOpenChange={() => {}}
      openInEditMode
      restrictContactFields={restrictContactFields}
    />,
  );
}

describe("Student Details — collaborator contact-field restriction", () => {
  it("disables Email and Phone for a non-admin, non-assignee collaborator", async () => {
    renderDialog(true);
    const emailInput = await screen.findByPlaceholderText("Enter email");
    expect(emailInput).toBeDisabled();
    const [corePhoneInput] = await screen.findAllByPlaceholderText("Phone number");
    expect(corePhoneInput).toBeDisabled();
  });

  it("leaves First Name editable for that same collaborator", async () => {
    renderDialog(true);
    const firstNameInput = await screen.findByPlaceholderText("Enter first name");
    expect(firstNameInput).not.toBeDisabled();
  });

  it("leaves Email and Phone editable for an admin/assignee session (default)", async () => {
    renderDialog(false);
    const emailInput = await screen.findByPlaceholderText("Enter email");
    expect(emailInput).not.toBeDisabled();
    const [corePhoneInput] = await screen.findAllByPlaceholderText("Phone number");
    expect(corePhoneInput).not.toBeDisabled();
  });
});
