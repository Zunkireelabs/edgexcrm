// Guard: the processing fee is an audit marker only. Consent and application
// routes must never read it, so an unverified ("claimed") or missing fee can't
// hold up the consent form or application fill-up.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src/app/(main)/api/v1");
const GATED_ROUTES = [
  "leads/[id]/consent/route.ts",
  "leads/[id]/applications/route.ts",
  "applications/route.ts",
];

describe("processing fee never gates consent or applications", () => {
  it.each(GATED_ROUTES)("%s does not read pre_app_fee_*", (route) => {
    const src = readFileSync(join(ROOT, route), "utf8");
    expect(src).not.toMatch(/pre_app_fee/);
    expect(src).not.toMatch(/isFeeComplete/);
  });
});
