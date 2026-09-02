import { describe, it, expect } from "vitest";
import { buildNavIndex } from "./build-nav-index";

const BASE = {
  industrySidebarItems: [],
  leadLists: [],
  stagingLists: [],
  allowedNavKeys: null,
  industryId: "education_consultancy" as string | null,
};

function orcaEntries(isOrcaAvailable: boolean) {
  return buildNavIndex({ ...BASE, isOrcaAvailable }).filter((r) => r.id.startsWith("orca-"));
}

describe("buildNavIndex — Orca palette entries", () => {
  it("lists the six Orca pages when Orca is available", () => {
    const hrefs = orcaEntries(true).map((r) => (r.action.kind === "route" ? r.action.href : null));
    expect(hrefs).toEqual([
      "/orca",
      "/orca/activity",
      "/orca/structure",
      "/orca/tasks",
      "/orca/agents",
      "/orca/review",
    ]);
  });

  it("emits no Orca entries when Orca is not available (role/flag gate)", () => {
    const entries = orcaEntries(false);
    expect(entries).toEqual([]);
    // The review queue in particular must never surface as a ⌘K link that 404s.
    const all = buildNavIndex({ ...BASE, isOrcaAvailable: false });
    expect(all.some((r) => r.action.kind === "route" && r.action.href === "/orca/review")).toBe(false);
  });

  it("never lists the removed /orca/roles or /orca/compare pages", () => {
    const hrefs = orcaEntries(true).map((r) => (r.action.kind === "route" ? r.action.href : null));
    expect(hrefs).not.toContain("/orca/roles");
    expect(hrefs).not.toContain("/orca/compare");
  });
});
