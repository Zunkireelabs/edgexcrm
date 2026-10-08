// @vitest-environment jsdom
//
// Guardian Details: what staff see in "Guardian Name" is exactly what the consent prints.
// Father/Mother -> that parent's own name, locked (the form ignores anything typed there);
// anyone else -> an editable box.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const guardianInput = () => document.getElementById("guardian_name") as HTMLInputElement;

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function open(lead: Record<string, unknown>) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })) as unknown as typeof fetch;
  return render(
    <PersonalDetailsDialog
      lead={{ id: "lead-1", custom_fields: {}, destinations: [], father_name: "Ram", mother_name: "Sita", ...lead } as unknown as Lead}
      open
      onOpenChange={() => {}}
      openInEditMode
    />,
  );
}

describe("Guardian Name in Student Details", () => {
  it("Mother: shows Sita, locked, with a note — even if a stale name is stored", async () => {
    open({ guardian_relationship: "Mother", guardian_name: "Ram" });
    await waitFor(() => expect(guardianInput()).not.toBeNull());
    expect(guardianInput().value).toBe("Sita");
    expect(guardianInput()).toBeDisabled();
    expect(screen.getByText("Taken from Mother's Name above. Change it there.")).toBeInTheDocument();
  });

  it("Uncle: an editable box holding the typed name", async () => {
    open({ guardian_relationship: "Uncle", guardian_name: "Hari" });
    await waitFor(() => expect(guardianInput()).not.toBeNull());
    expect(guardianInput().value).toBe("Hari");
    expect(guardianInput()).toBeEnabled();
    expect(screen.queryByText(/Taken from/)).not.toBeInTheDocument();
  });

  it("Father with no father's name on file: editable, so a name can still be typed", async () => {
    open({ guardian_relationship: "Father", father_name: null, guardian_name: "" });
    await waitFor(() => expect(guardianInput()).not.toBeNull());
    expect(guardianInput()).toBeEnabled();
  });

  it("no relationship picked, only one parent on file: shows that parent, locked, saying it's a default", async () => {
    open({ guardian_relationship: null, father_name: "Ram", mother_name: null });
    await waitFor(() => expect(guardianInput()).not.toBeNull());
    expect(guardianInput().value).toBe("Ram");
    expect(guardianInput()).toBeDisabled();
    expect(screen.getByText("Defaults to Father (the only parent on file). Pick a relationship to change it.")).toBeInTheDocument();
  });

  it("no relationship picked, both parents on file: editable and empty — staff must choose", async () => {
    open({ guardian_relationship: null });
    await waitFor(() => expect(guardianInput()).not.toBeNull());
    expect(guardianInput().value).toBe("");
    expect(guardianInput()).toBeEnabled();
  });
});
