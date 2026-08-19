import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { manifest as educationManifest } from "@/industries/education-consultancy/manifest";
import { getIndustrySidebarItems } from "@/industries/_loader";
import type { SidebarEntry, SidebarItem } from "@/industries/_types";

// Regression test for F-8: the education branch of shell.tsx renders an
// explicit allowlist of hrefs rather than iterating the manifest's sidebar
// array, so a new manifest entry (like /sms) can be registered and gated
// correctly everywhere else while silently never appearing in the nav. This
// is a crude source-text check, but it's the only thing that currently
// connects the manifest to the shell at all.
//
// Groups are flattened to their children so an item nested inside a
// SidebarGroup is still checked — the same class of bug this test exists
// to catch.
const flatten = (entries: readonly SidebarEntry[]): readonly SidebarItem[] =>
  entries.flatMap((e) => (e.kind === "group" ? e.children : [e]));

describe("shell.tsx education nav mirrors the manifest sidebar", () => {
  const shellSource = readFileSync(join(__dirname, "shell.tsx"), "utf8");

  for (const item of flatten(educationManifest.sidebar)) {
    it(`renders a nav entry for ${item.href}`, () => {
      expect(shellSource).toContain(`eduItem("${item.href}")`);
    });
  }
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
