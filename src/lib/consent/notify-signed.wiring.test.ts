import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Contract: the public e-sign route notifies the sender exactly once, and only AFTER the signature is saved and the
// "already signed" / expired guards have returned — so a repeat or invalid click can never ping the sender.
const src = readFileSync(join(process.cwd(), "src/app/api/public/consent/[token]/route.ts"), "utf8");
const count = (needle: string) => src.split(needle).length - 1;

describe("consent e-sign → sender notification wiring", () => {
  it("calls notifyConsentSigned exactly once", () => {
    expect(count("notifyConsentSigned({")).toBe(1);
  });
  it("calls it after the signature update and the already-signed guard", () => {
    const at = src.indexOf("notifyConsentSigned({");
    expect(at).toBeGreaterThan(src.indexOf('.update(update)'));
    expect(at).toBeGreaterThan(src.indexOf('"ALREADY_SIGNED"'));
    expect(at).toBeGreaterThan(src.indexOf('"consent.signed"'));
  });
  it("passes the sender (created_by) from the consent row", () => {
    expect(src).toContain("senderUserId: row.created_by");
    expect(src).toContain("missing_fields, created_by");
  });
});
