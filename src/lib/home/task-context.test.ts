import { describe, it, expect } from "vitest";
import { deriveTaskContext } from "./task-context";

const project = { id: "p1", name: "Website Revamp" };
const deal = { id: "d1", name: "Acme Renewal" };
const lead = { id: "l1", first_name: "Jane", last_name: "Doe" };

describe("deriveTaskContext precedence", () => {
  it("project beats deal beats lead when all three are present", () => {
    const ctx = deriveTaskContext({ projects: project, deals: deal, leads: lead }, true);
    expect(ctx).toEqual({ label: "Website Revamp", href: "/projects/p1" });
  });

  it("deal beats lead when project is absent", () => {
    const ctx = deriveTaskContext({ projects: null, deals: deal, leads: lead }, true);
    expect(ctx).toEqual({ label: "Acme Renewal", href: "/deals/d1" });
  });

  it("falls back to the lead when project and deal are absent", () => {
    const ctx = deriveTaskContext({ projects: null, deals: null, leads: lead }, true);
    expect(ctx).toEqual({ label: "Jane Doe", href: "/leads/l1" });
  });

  it("renders nothing when all three links are null", () => {
    const ctx = deriveTaskContext({ projects: null, deals: null, leads: null }, true);
    expect(ctx).toBeNull();
  });

  it("renders the project chip as plain text (no href) when the project board is disabled", () => {
    const ctx = deriveTaskContext({ projects: project, deals: null, leads: null }, false);
    expect(ctx).toEqual({ label: "Website Revamp", href: null });
  });

  it("deal and lead chips stay links regardless of the project-board flag", () => {
    expect(deriveTaskContext({ projects: null, deals: deal, leads: null }, false)).toEqual({
      label: "Acme Renewal",
      href: "/deals/d1",
    });
    expect(deriveTaskContext({ projects: null, deals: null, leads: lead }, false)).toEqual({
      label: "Jane Doe",
      href: "/leads/l1",
    });
  });

  it("returns null for a lead with no first or last name", () => {
    const ctx = deriveTaskContext(
      { projects: null, deals: null, leads: { id: "l2", first_name: null, last_name: null } },
      true,
    );
    expect(ctx).toBeNull();
  });
});
