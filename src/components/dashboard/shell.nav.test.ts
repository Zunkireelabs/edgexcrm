import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { manifest as educationManifest } from "@/industries/education-consultancy/manifest";
import { EDUCATION_NAV_LAYOUT } from "@/industries/education-consultancy/nav-layout";
import { getIndustrySidebarItems } from "@/industries/_loader";
import type { SidebarEntry, SidebarItem } from "@/industries/_types";

// Regression test for F-8 (updated for EDGEX-86): the education sidebar is now the data layout
// EDUCATION_NAV_LAYOUT rendered through resolveNavSections, but it is still an explicit allowlist of
// hrefs rather than an iteration of the manifest's sidebar array — so a new manifest entry (like /sms)
// can be registered and gated correctly everywhere else while silently never appearing in the nav.
// This connects the manifest to the layout, and the layout to the shell.
//
// Groups are flattened to their children so an item nested inside a
// SidebarGroup is still checked — the same class of bug this test exists
// to catch.
const flatten = (entries: readonly SidebarEntry[]): readonly SidebarItem[] =>
  entries.flatMap((e) => (e.kind === "group" ? e.children : [e]));

describe("education nav layout mirrors the manifest sidebar", () => {
  const shellSource = readFileSync(join(__dirname, "shell.tsx"), "utf8");
  const layoutKeys = new Set<string>(EDUCATION_NAV_LAYOUT.flatMap((s) => s.entries));

  it("shell.tsx renders the education sidebar from EDUCATION_NAV_LAYOUT", () => {
    expect(shellSource).toContain("renderLayout(EDUCATION_NAV_LAYOUT");
  });

  for (const item of flatten(educationManifest.sidebar)) {
    it(`has a layout entry for ${item.href}`, () => {
      expect(layoutKeys.has(item.href)).toBe(true);
    });
  }
});

describe("EDGEX-86: archive lists render once, in the shared footer", () => {
  const shellSource = readFileSync(join(__dirname, "shell.tsx"), "utf8");
  it("ArchiveNavLinks is mounted exactly once", () => {
    expect(shellSource.match(/<ArchiveNavLinks/g)?.length).toBe(1);
  });
});

// Regression test for F-10: SMS's sidebar entry declares `entitlement:
// "sms_enabled"` but getIndustrySidebarItems() never consulted entitlements,
// so the nav item rendered for every education owner/admin regardless of
// whether the tenant actually holds the entitlement — 404 on click.
describe("getIndustrySidebarItems gates entitlement-scoped items", () => {
  const hrefsOf = (entries: readonly SidebarEntry[]): readonly string[] =>
    flatten(entries).map((i) => i.href);

  it("includes /sms when the tenant holds sms_enabled", () => {
    const items = getIndustrySidebarItems(
      "education_consultancy",
      "owner",
      undefined,
      { sms_enabled: true },
    );
    expect(hrefsOf(items)).toContain("/sms");
  });

  it("excludes /sms when the tenant does not hold sms_enabled", () => {
    const items = getIndustrySidebarItems("education_consultancy", "owner", undefined, {});
    expect(hrefsOf(items)).not.toContain("/sms");
  });

  it("still includes /campaigns (no entitlement gate) when sms_enabled is absent", () => {
    const items = getIndustrySidebarItems("education_consultancy", "owner", undefined, {});
    expect(hrefsOf(items)).toContain("/campaigns");
  });
});
