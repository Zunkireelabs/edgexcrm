import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// TENANT-ISOLATION-TESTS-BRIEF.md §2a — the single most valuable test in that brief.
//
// Phase A (#354) rewrote ~29 call sites from the RLS/user-context client
// (`await createClient()`) to `createServiceClient()` + an explicit `.eq("tenant_id", ...)`,
// and in doing so REMOVED RLS as the backstop on those paths: a service client bypasses
// RLS entirely, so the explicit filter in application code is now the ONLY thing
// separating tenants there. Three stale PRs (#177, #98, #33) all touch queries.ts — if any
// of them rebases with a "keep my whole file" conflict resolution, it silently reverts the
// Phase A conversion and restores the exposure, WITH GREEN CI, because nothing tested for
// it. This guard is that test.
//
// If you tripped this: you introduced (or rebased in) a `.from()` table read on a client
// bound from `await createClient()`. That client carries the CALLER's session, not the
// service role — under RLS it's scoped correctly today, but the whole point of Phase A was
// that RLS is not the thing we want standing between tenants anymore (see the phase-B
// revoke this brief exists to unblock). Convert the read to `createServiceClient()` /
// `scopedClient(auth)` with an explicit `.eq("tenant_id", ...)`, OR — if the read
// genuinely needs the caller's session (e.g. routing through `leads_visible_to_user()`,
// which is SECURITY DEFINER and fail-closed without a real `auth.uid()`) — restructure it
// as a `.rpc()` call the way `visibleLeadsBase()` does, never a direct `.from()`.

const EXEMPT_SITES: Record<string, "rpc-only" | "auth-only"> = {
  // rpc-only: the createClient() binding is only ever handed to a .rpc() call
  // (directly, or via visibleLeadsBase() -> leads_visible_to_user(), which is
  // SECURITY DEFINER + fail-closed on a missing auth.uid() — the RPC needs the
  // caller's own session, a service client would silently return zero rows).
  "src/lib/leads/aggregates.ts": "rpc-only", // .rpc("lead_aggregates", ...)
  "src/lib/supabase/queries.ts": "rpc-only", // visibleLeadsBase() call sites (getLeads, getLeadUtmRows, getLeadsPage, getLeadsForPipeline)
  "src/app/(main)/api/v1/leads/route.ts": "rpc-only", // visibleLeadsBase() call site
  "src/app/(main)/api/v1/lead-lists/route.ts": "rpc-only", // visibleLeadsBase() count-only call site
  "src/app/(main)/(dashboard)/classes/page.tsx": "rpc-only", // visibleLeadsBase() call site
  "src/app/(main)/(dashboard)/applications/page.tsx": "rpc-only", // visibleLeadsBase() call site
  "src/app/(main)/api/v1/sms/blasts/[id]/preview/route.ts": "rpc-only", // resolveAudience() -> visibleLeadsBase() call site
  "src/app/(main)/api/v1/sms/blasts/[id]/send/route.ts": "rpc-only", // resolveAudience() -> visibleLeadsBase() call site
  "src/app/(main)/api/v1/inbox/conversations/route.ts": "rpc-only", // visibleLeadIdsAmong() -> visibleLeadsBase() call site
  "src/app/(main)/api/v1/inbox/conversations/[id]/route.ts": "rpc-only", // canAccessConversationLead() -> visibleLeadsBase() call site
  "src/app/(main)/api/v1/inbox/conversations/[id]/messages/route.ts": "rpc-only", // canAccessConversationLead() -> visibleLeadsBase() call site
  "src/app/(main)/api/v1/inbox/conversations/[id]/draft/route.ts": "rpc-only", // canAccessConversationLead() -> visibleLeadsBase() call site
  "src/app/(main)/(dashboard)/inbox/page.tsx": "rpc-only", // visibleLeadIdsAmong() -> visibleLeadsBase() call site
  // auth-only: the createClient() binding is only ever used for `.auth.*` calls —
  // never a table read, so there is nothing for RLS-vs-app-filter to protect.
  "src/lib/supabase/server.ts": "auth-only", // getCachedUser() -> supabase.auth.getClaims()
  "src/app/(main)/api/auth/callback/route.ts": "auth-only", // supabase.auth.exchangeCodeForSession()
};

const CREATE_CLIENT_BINDING = /\b(?:const|let)\s+(\w+)\s*=\s*await\s+createClient\(\)/g;

/**
 * Regex-based, not AST-based — a deliberate structural check (see brief §1: this whole
 * suite is structural, not a live-DB proof). Scoped to file-wide "does this identifier
 * ever call .from()", not per-function-scope, so it can theoretically over- or
 * under-attribute across two same-named bindings in different functions in one file.
 * Acceptable for an architecture guard whose job is "flag it for human review", not
 * silently auto-fix.
 */
function findCreateClientFromViolations(relPath: string, content: string): string[] {
  const violations: string[] = [];
  const re = new RegExp(CREATE_CLIENT_BINDING);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const varName = match[1];
    const fromRe = new RegExp(`\\b${varName}\\s*\\.from\\(`);
    if (fromRe.test(content)) {
      violations.push(
        `${relPath}: "${varName}" (bound from \`await createClient()\`) calls .from() directly — ` +
          `see docs/TENANT-ISOLATION-TESTS-BRIEF.md §2a`,
      );
    }
  }
  return violations;
}

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("architecture guard — no raw createClient() .from() table reads (TENANT-ISOLATION-TESTS-BRIEF §2a)", () => {
  const SRC_ROOT = path.join(process.cwd(), "src");

  it("every `await createClient()` site in src/ is on the reviewed exemption list, and none of them call .from() on that binding", () => {
    const files = listSourceFiles(SRC_ROOT);
    const violations: string[] = [];
    const filesWithBinding: string[] = [];

    for (const abs of files) {
      const content = fs.readFileSync(abs, "utf8");
      if (!content.includes("await createClient()")) continue;

      const rel = path.relative(process.cwd(), abs).split(path.sep).join("/");
      filesWithBinding.push(rel);

      if (!(rel in EXEMPT_SITES)) {
        violations.push(
          `${rel}: uses \`await createClient()\` (the RLS/user-context client) but is not on the reviewed ` +
            `exemption list in this test. A service client bypasses RLS, so an unreviewed createClient()-bound ` +
            `.from() read would be the ONLY thing separating tenants here (docs/TENANT-ISOLATION-TESTS-BRIEF.md §2a). ` +
            `Either add it to EXEMPT_SITES in this file with a reason, or convert the read to createServiceClient() ` +
            `/ scopedClient(auth) with an explicit .eq("tenant_id", ...).`,
        );
      }

      violations.push(...findCreateClientFromViolations(rel, content));
    }

    expect(violations).toEqual([]);

    // The exemption list itself must be accurate — a stale entry for a file that no
    // longer uses createClient() at all would be a reviewed-looking list that isn't.
    for (const exemptFile of Object.keys(EXEMPT_SITES)) {
      expect(filesWithBinding).toContain(exemptFile);
    }
  });

  it("fires when a user-context client is used for a .from() table read (proves the guard actually works, not just that it's silent)", () => {
    const maliciousSource = `
      export async function leak(tenantId: string) {
        const supabase = await createClient();
        const { data } = await supabase.from("leads").select("*").eq("tenant_id", tenantId);
        return data;
      }
    `;
    const violations = findCreateClientFromViolations("src/fixtures/deliberately-broken.ts", maliciousSource);
    expect(violations).toEqual([
      'src/fixtures/deliberately-broken.ts: "supabase" (bound from `await createClient()`) calls .from() directly — see docs/TENANT-ISOLATION-TESTS-BRIEF.md §2a',
    ]);
  });

  it("does not fire for a createClient() binding used only via .rpc() (the visibleLeadsBase() pattern)", () => {
    const safeSource = `
      export async function ok(tenantId: string) {
        const userClient = await createClient();
        return userClient.rpc("leads_visible_to_user", { p_tenant: tenantId });
      }
    `;
    expect(findCreateClientFromViolations("src/fixtures/safe.ts", safeSource)).toEqual([]);
  });
});
