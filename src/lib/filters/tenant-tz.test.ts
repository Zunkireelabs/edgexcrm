import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { dayBoundsInTz } from "./compile";
import { DEFAULT_TENANT_TZ, resolveTenantTz } from "./tenant-tz";

describe("resolveTenantTz (EDGEX-114)", () => {
  it("uses the tenant's timezone; a missing, blank or invalid one falls back to Asia/Kathmandu", () => {
    expect(resolveTenantTz("America/New_York")).toBe("America/New_York");
    expect(resolveTenantTz("Asia/Kathmandu")).toBe("Asia/Kathmandu");
    for (const bad of [null, undefined, "", "  ", "Not/AZone"]) expect(resolveTenantTz(bad)).toBe(DEFAULT_TENANT_TZ);
  });
});

describe("a date filter counts days in the tenant's timezone", () => {
  it("Nepal: a lead at 00:30 local on 9 Oct is 'on 9 Oct' (it is 8 Oct 18:45 UTC, so UTC days would put it on the 8th)", () => {
    const lead = Date.parse("2026-10-08T18:45:00Z");
    const nepal = dayBoundsInTz("2026-10-09", "Asia/Kathmandu");
    expect(lead >= Date.parse(nepal.start) && lead < Date.parse(nepal.end)).toBe(true);
    const utc = dayBoundsInTz("2026-10-09", "UTC");
    expect(lead >= Date.parse(utc.start) && lead < Date.parse(utc.end)).toBe(false);
  });
  it("a foreign timezone behaves the same way: New York 00:30 on 9 Oct is 04:30 UTC the same day, 23:30 on the 8th is the 8th", () => {
    const b = dayBoundsInTz("2026-10-09", "America/New_York");
    expect(Date.parse("2026-10-09T04:30:00Z")).toBeGreaterThanOrEqual(Date.parse(b.start));
    expect(Date.parse("2026-10-09T03:30:00Z")).toBeLessThan(Date.parse(b.start));
  });
});

// Guard: no production CompileCtx that COMPILES a filter may be built with a literal "UTC". The allowed uses are UI files that only build
// the field registry (labels and options; `now` is the epoch, no date is ever compiled) and a display window in Pulse that is not a
// CompileCtx at all, and (EDGEX-173) two Applications files that arrived with ui-v2: the workspace page (registry + URL decode only,
// `now` is the epoch) and GET /api/v1/applications (compiles EMPTY_TREE, so no date is ever compiled). They are listed on purpose so a
// new one has to be argued for.
describe("no literal UTC CompileCtx", () => {
  const ALLOWED = new Set([
    "src/components/dashboard/leads-table.tsx",
    "src/industries/_shared/features/email-campaigns/ui/blast-composer.tsx",
    "src/industries/_shared/features/outreach/ui/audience-picker.tsx",
    "src/industries/_shared/features/sms/ui/blast-composer.tsx",
    "src/industries/education-consultancy/features/pulse/ui/pulse-page.tsx",
    "src/industries/education-consultancy/features/application-tracking/pages/applications-workspace.tsx",
    "src/app/(main)/api/v1/applications/route.ts",
  ]);
  const root = join(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  it("fails on any `tz: \"UTC\"` outside the allowlist", () => {
    const offenders = walk(root)
      .filter((f) => /tz:\s*"UTC"/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(process.cwd().length + 1))
      .filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });
});
