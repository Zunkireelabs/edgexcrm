// @vitest-environment jsdom
//
// Client request (Student Details > Personal Information): one country field only, as a dropdown,
// and no Preferred Contact — to cut the counselor's data entry. Renders the real dialog.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";
import { CORE_IDENTITY_FIELDS } from "./personal-details-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function renderDialog(lead: Record<string, unknown>) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })) as unknown as typeof fetch;
  render(
    <PersonalDetailsDialog
      lead={{ id: "lead-1", custom_fields: {}, destinations: [], ...lead } as unknown as Lead}
      open
      onOpenChange={() => {}}
      openInEditMode
    />,
  );
}

describe("Student Details > Personal Information fields", () => {
  it("offers Nationality as a dropdown, not free text", () => {
    const nationality = CORE_IDENTITY_FIELDS.find((f) => f.key === "nationality");
    expect(nationality?.type).toBe("select");
    expect(nationality?.options.length).toBeGreaterThan(100);
  });

  it("no longer asks for Residence Country or Preferred Contact", async () => {
    renderDialog({});
    await screen.findAllByText("Nationality", { exact: true });
    expect(screen.queryByText("Residence Country", { exact: true })).toBeNull();
    expect(screen.queryByText("Preferred Contact", { exact: true })).toBeNull();
  });

  it("keeps an old typed nationality visible in the dropdown", async () => {
    renderDialog({ nationality: "Nepali" });
    expect((await screen.findAllByText("Nepali", { exact: true })).length).toBeGreaterThan(0);
  });
});
