import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// process-inbound's own tests need a local database, so the one thing they can't see is pinned here: the bell for a new
// customer message must come from resolveInboundRecipients (the website-chat "who is alerted" rule), not a copy of the old logic.
describe("process-inbound uses the shared alert rule", () => {
  const src = readFileSync(resolve(__dirname, "process-inbound.ts"), "utf8");

  it("asks resolveInboundRecipients who to alert and uses its title", () => {
    expect(src).toContain('from "@/lib/inbox/inbound-recipients"');
    expect(src).toMatch(/resolveInboundRecipients\(supabase,/);
    expect(src).toMatch(/title: notificationTitle/);
  });

  it("no longer builds its own recipient list", () => {
    expect(src).not.toMatch(/new Set<string>\(\)/);
    expect(src).not.toContain("getTenantAdminRecipients");
  });
});
