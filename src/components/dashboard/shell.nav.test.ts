import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { manifest as educationManifest } from "@/industries/education-consultancy/manifest";

// Regression test for F-8: the education branch of shell.tsx renders an
// explicit allowlist of hrefs rather than iterating the manifest's sidebar
// array, so a new manifest entry (like /sms) can be registered and gated
// correctly everywhere else while silently never appearing in the nav. This
// is a crude source-text check, but it's the only thing that currently
// connects the manifest to the shell at all.
describe("shell.tsx education nav mirrors the manifest sidebar", () => {
  const shellSource = readFileSync(join(__dirname, "shell.tsx"), "utf8");

  for (const item of educationManifest.sidebar) {
    it(`renders a nav entry for ${item.href}`, () => {
      expect(shellSource).toContain(`eduItem("${item.href}")`);
    });
  }
});
