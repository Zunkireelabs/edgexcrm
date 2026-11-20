import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// This project sets --radius: 1rem, so Tailwind's NAMED radii are not the defaults (rounded-lg = 16px, rounded-md = 12px,
// rounded-xl = 20px). The lead detail must match the mockup's pixel radii, so it only uses explicit values
// (rounded-[12px], rounded-[8px], rounded-full …). Fails on any named size class, also with a side prefix (rounded-t-lg).
const NAMED = /\brounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-(?:sm|md|lg|xl|2xl|3xl)\b/;
const DIR = __dirname;

describe("lead-detail radii", () => {
  const files = fs.readdirSync(DIR, { recursive: true }).map(String).filter((f) => /\.(tsx?|ts)$/.test(f) && !f.includes(".test."));
  it("scans the feature's source files", () => expect(files.length).toBeGreaterThan(1));
  for (const f of files) {
    it(`${f} has no named radius class`, () => {
      const src = fs.readFileSync(path.join(DIR, f), "utf8");
      expect(src.match(NAMED)?.[0] ?? null).toBeNull();
    });
  }
});
