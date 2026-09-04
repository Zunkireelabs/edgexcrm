import { describe, it, expect } from "vitest";
import { buildNavIndex } from "./build-nav-index";
import { SETTINGS_CATEGORIES } from "@/components/dashboard/settings/modal/settings-registry";

const BASE = {
  industrySidebarItems: [],
  leadLists: [],
  stagingLists: [],
  allowedNavKeys: null,
  industryId: "education_consultancy" as string | null,
  role: "owner",
  // Raw AI gate (env + tenant grant) — drives the "AI & Orca" settings tab.
  aiAssistantEnabled: true,
  // Narrower owner-only gate — drives the Orca palette entries.
  isOrcaAvailable: true,
};

function orcaEntries(isOrcaAvailable: boolean) {
  return buildNavIndex({ ...BASE, isOrcaAvailable }).filter((r) => r.id.startsWith("orca-"));
}

function settingsIds(opts: Partial<typeof BASE>) {
  return buildNavIndex({ ...BASE, ...opts })
    .filter((r) => r.id.startsWith("settings-") || r.id === "settings-root")
    .map((r) => r.id);
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

describe("buildNavIndex — Settings palette entries", () => {
  it("owner sees every non-education tab plus ai-orca and leave", () => {
    const ids = settingsIds({ role: "owner", industryId: "education_consultancy", isOrcaAvailable: true });
    expect(ids).toContain("settings-root");
    expect(ids).toContain("settings-ai-orca");
    expect(ids).toContain("settings-leave");
    expect(ids).toContain("settings-general");
    expect(ids).toContain("settings-integrations");
  });

  it("counselor sees no settings entries at all — not even the parent", () => {
    const ids = settingsIds({ role: "counselor" });
    expect(ids).toEqual([]);
  });

  it("viewer sees no settings entries at all", () => {
    const ids = settingsIds({ role: "viewer" });
    expect(ids).toEqual([]);
  });

  it("owner without AI enabled does not see the ai-orca tab", () => {
    const ids = settingsIds({ role: "owner", aiAssistantEnabled: false, isOrcaAvailable: false });
    expect(ids).toContain("settings-root");
    expect(ids).toContain("settings-general");
    expect(ids).not.toContain("settings-ai-orca");
  });

  it("admin (AI enabled) sees settings tabs but NOT ai-orca, and no Orca palette entries", () => {
    // The trap regression: isSettingsAdmin stays owner-or-admin (admin keeps
    // every other tab), but the owner-only Orca gate hides ai-orca and every
    // orca-* palette link from an admin.
    const all = buildNavIndex({ ...BASE, role: "admin", aiAssistantEnabled: true, isOrcaAvailable: false });
    const ids = all.map((r) => r.id);
    expect(ids).toContain("settings-root");
    expect(ids).toContain("settings-general");
    expect(ids).toContain("settings-integrations");
    expect(ids).not.toContain("settings-ai-orca");
    expect(all.some((r) => r.id.startsWith("orca-"))).toBe(false);
  });

  it("non-education owner does not see academic-operations or compliance", () => {
    const ids = settingsIds({ role: "owner", industryId: "it_agency" });
    expect(ids).not.toContain("settings-academic-operations");
    expect(ids).not.toContain("settings-compliance");
  });

  it("education owner sees academic-operations and compliance", () => {
    const ids = settingsIds({ role: "owner", industryId: "education_consultancy" });
    expect(ids).toContain("settings-academic-operations");
    expect(ids).toContain("settings-compliance");
  });

  it("drift guard: every registry category has a settings palette entry available to an owner", () => {
    // Owner in education with Orca on — the maximally-permissive context, so
    // every category's isVisible() passes and each must surface exactly once.
    const ids = settingsIds({ role: "owner", industryId: "education_consultancy", isOrcaAvailable: true });
    for (const cat of SETTINGS_CATEGORIES) {
      expect(ids).toContain(`settings-${cat.key}`);
    }
  });
});
