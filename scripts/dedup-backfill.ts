/**
 * Lead dedup backfill CLI
 *
 * Usage:
 *   npx tsx scripts/dedup-backfill.ts                          # dry-run (safe, no writes)
 *   npx tsx scripts/dedup-backfill.ts --tenant <uuid>           # dry-run scoped to one tenant
 *   npx tsx scripts/dedup-backfill.ts --apply --tenant <uuid> --yes-i-reviewed-the-dry-run
 *   npx tsx scripts/dedup-backfill.ts --undo --tenant <uuid>    # reverse all backfill merges
 *
 * HARD RULES:
 *   - Dry-run is the default. --apply requires an explicit flag.
 *   - --apply on any non-synthetic tenant requires --yes-i-reviewed-the-dry-run.
 *   - NEVER run --apply on production/customer data without Opus+Sadin review of the dry-run.
 *   - The synthetic tenant (Zunkiree Labs a0000000-0000-0000-0000-000000000001) is exempt
 *     from the --yes-i-reviewed-the-dry-run guard to support automated testing.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { runBackfill, undoBackfill } from "../src/lib/leads/backfill";
import { normalizeEmail } from "../src/lib/leads/dedup";
import type { BackfillGroup, BackfillReport, BackfillApplyResult } from "../src/lib/leads/backfill";

config({ path: ".env.local" });

// ── config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNTHETIC_TENANT = "a0000000-0000-0000-0000-000000000001";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const UNDO = args.includes("--undo");
const REVIEWED = args.includes("--yes-i-reviewed-the-dry-run");

const tenantIdx = args.indexOf("--tenant");
const TENANT_ID: string | undefined = tenantIdx !== -1 ? args[tenantIdx + 1] : undefined;

const emailIdx = args.indexOf("--email");
const EMAIL_RAW: string | undefined = emailIdx !== -1 ? args[emailIdx + 1] : undefined;
const NORMALIZED_EMAIL: string | null = EMAIL_RAW ? normalizeEmail(EMAIL_RAW) : null;

if (APPLY && UNDO) {
  console.error("Cannot use --apply and --undo together.");
  process.exit(1);
}

// Safety guard: --apply on a non-synthetic tenant requires explicit confirmation token
if (APPLY && TENANT_ID && TENANT_ID !== SYNTHETIC_TENANT && !REVIEWED) {
  console.error(
    "\n⛔  SAFETY STOP\n" +
    `You are requesting --apply on tenant ${TENANT_ID}, which is not the synthetic Zunkiree Labs tenant.\n` +
    "This will merge real leads. You MUST:\n" +
    "  1. Run without --apply first to review the dry-run report.\n" +
    "  2. Review the report with Opus + Sadin.\n" +
    "  3. Re-run with --yes-i-reviewed-the-dry-run to confirm.\n\n" +
    "Re-run with: --apply --tenant " + TENANT_ID + " --yes-i-reviewed-the-dry-run\n"
  );
  process.exit(1);
}

// Safety guard: --apply with no --tenant also requires confirmation (affects all tenants)
if (APPLY && !TENANT_ID && !REVIEWED) {
  console.error(
    "\n⛔  SAFETY STOP\n" +
    "Running --apply without --tenant would merge duplicates across ALL tenants.\n" +
    "Add --tenant <uuid> to scope, or add --yes-i-reviewed-the-dry-run to confirm.\n"
  );
  process.exit(1);
}

// ── formatting ──────────────────────────────────────────────────────────────

function fmtChildCounts(counts: BackfillGroup["childCounts"][string]): string {
  const parts: string[] = [];
  if (counts.lead_notes) parts.push(`${counts.lead_notes} note${counts.lead_notes !== 1 ? "s" : ""}`);
  if (counts.lead_activities) parts.push(`${counts.lead_activities} activ.`);
  if (counts.lead_submissions) parts.push(`${counts.lead_submissions} subm.`);
  if (counts.lead_checklists) parts.push(`${counts.lead_checklists} check.`);
  if (counts.tasks) parts.push(`${counts.tasks} task${counts.tasks !== 1 ? "s" : ""}`);
  if (counts.email_threads) parts.push(`${counts.email_threads} thread${counts.email_threads !== 1 ? "s" : ""}`);
  return parts.length ? parts.join(", ") : "no children";
}

function printGroup(g: BackfillGroup, idx: number): void {
  console.log(`\n  Group ${idx + 1}: ${g.normalizedEmail} (tenant ${g.tenantId.slice(0, 8)}…)`);
  console.log(`    Canonical : ${g.canonicalId.slice(0, 8)}…`);
  if (Object.keys(g.fieldDelta).length) {
    console.log(`    Would fill: ${JSON.stringify(g.fieldDelta)}`);
  }
  g.absorbedIds.forEach((absId, j) => {
    const cc = g.childCounts[absId];
    console.log(`    Absorbed ${j + 1}: ${absId.slice(0, 8)}… — ${fmtChildCounts(cc)}`);
  });
}

function printReport(report: BackfillReport): void {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DRY-RUN REPORT (no data was modified)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Duplicate groups : ${report.totalGroups}`);
  console.log(`  Leads to absorb  : ${report.totalAbsorbed}`);

  if (report.totalGroups === 0) {
    console.log("\n  ✓ No live duplicate email groups found. Nothing to do.");
    return;
  }

  const shown = report.sample.length;
  console.log(`\n  Showing ${shown} of ${report.totalGroups} group${report.totalGroups !== 1 ? "s" : ""}:`);
  report.sample.forEach((g, i) => printGroup(g, i));

  if (report.totalGroups > 20) {
    console.log(`\n  … and ${report.totalGroups - 20} more groups not shown.`);
  }

  console.log("\n  To apply: npx tsx scripts/dedup-backfill.ts --apply --tenant <uuid> --yes-i-reviewed-the-dry-run");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const emailScope = NORMALIZED_EMAIL ? ` / email ${NORMALIZED_EMAIL}` : "";
  const scope = (TENANT_ID ? `tenant ${TENANT_ID}` : "all tenants") + emailScope;

  if (UNDO) {
    console.log(`\n↩  Undoing backfill merges for ${scope}…`);
    const result = await undoBackfill(
      supabase as Parameters<typeof undoBackfill>[0],
      { tenantId: TENANT_ID, normalizedEmail: NORMALIZED_EMAIL ?? undefined }
    );
    console.log(`\n  Undone  : ${result.undone}`);
    if (result.errors.length) {
      console.log(`  Errors  : ${result.errors.length}`);
      result.errors.forEach((e) => console.log(`    merge ${e.mergeId.slice(0, 8)}…: ${e.error}`));
    }
    console.log(result.errors.length === 0 ? "\n  ✓ Undo complete — no errors.\n" : "\n  ⚠  Undo finished with errors.\n");
    return;
  }

  if (!APPLY) {
    // Dry-run
    console.log(`\n🔍  Dry-run for ${scope}…`);
    const result = await runBackfill(
      supabase as Parameters<typeof runBackfill>[0],
      { apply: false, tenantId: TENANT_ID, normalizedEmail: NORMALIZED_EMAIL ?? undefined }
    );
    printReport(result as BackfillReport);
    return;
  }

  // Apply
  console.log(`\n🔀  Applying backfill for ${scope}…`);
  const result = await runBackfill(
    supabase as Parameters<typeof runBackfill>[0],
    { apply: true, tenantId: TENANT_ID, normalizedEmail: NORMALIZED_EMAIL ?? undefined }
  ) as BackfillApplyResult;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  APPLY RESULT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Merged  : ${result.merged}`);
  console.log(`  Skipped : ${result.skipped} (already merged)`);
  console.log(`  Errors  : ${result.errors.length}`);
  if (result.errors.length) {
    result.errors.forEach((e) =>
      console.log(`    canonical ${e.canonicalId.slice(0, 8)}… ← absorbed ${e.absorbedId.slice(0, 8)}…: ${e.error}`)
    );
  }
  console.log(result.errors.length === 0 ? "\n  ✓ Backfill complete — no errors.\n" : "\n  ⚠  Backfill finished with errors — review above.\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n✗ Fatal error:", err.message ?? err);
  process.exit(1);
});
