import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Contract: every route that CREATES a lead dispatches the new-lead admin email exactly once, and only from the
// brand-new-insert path (after the dedupe / idempotency early-returns). Without route-level harnesses for the two
// large routes, this keeps the call from being silently removed, duplicated, or moved into a dedupe/update path.
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const count = (src: string, needle: string) => src.split(needle).length - 1;

const ROUTES: { name: string; file: string; mustComeAfter: string }[] = [
  {
    name: "public form submit",
    file: "src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts",
    mustComeAfter: "void processFormSmsAutoresponder(\n    formConfig as FormConfig,\n    { ...leadPayload, id: leadId } as Lead,",
  },
  {
    name: "POST /leads",
    file: "src/app/(main)/api/v1/leads/route.ts",
    mustComeAfter: 'log.error({ err }, "Email rule on create failed")',
  },
  {
    name: "CRM integration",
    file: "src/app/(main)/api/v1/integrations/crm/leads/route.ts",
    mustComeAfter: 'console.error("[crm/leads] assignDisplayIds failed", err)',
  },
];

describe("new-lead admin email wiring", () => {
  for (const r of ROUTES) {
    it(`${r.name}: dispatched exactly once, from the new-insert path only`, () => {
      const src = read(r.file);
      expect(count(src, "dispatchNotificationEmail(newLeadEvent")).toBe(1);
      expect(src.indexOf("dispatchNotificationEmail(newLeadEvent")).toBeGreaterThan(src.indexOf(r.mustComeAfter));
    });
  }
});
