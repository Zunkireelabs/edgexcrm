/**
 * Backfill script: sends kb/item.ingest.requested for knowledge base items
 * that need (re-)ingestion:
 *   - status='ready' AND chunk_count IS NULL — e.g. items created before
 *     AI_INGESTION_ENABLED was flipped on, or a dropped send.
 *   - status IN ('pending','processing') AND updated_at < 15 minutes ago —
 *     a dropped Inngest event (e.g. the dev server was down when the item
 *     was created) leaves the item stuck mid-pipeline forever; this happened
 *     live during Phase 2B verification. 15 minutes is comfortably past the
 *     ingestion function's own retry window, so a legitimately in-flight
 *     item is never mistaken for a stuck one.
 *
 * Usage:
 *   npx tsx scripts/backfill-kb-ingestion.ts                # all AI-enabled tenants
 *   npx tsx scripts/backfill-kb-ingestion.ts --tenant <id>   # one tenant, any ai_enabled state
 *
 * Requires:
 *   - AI_INGESTION_ENABLED=true in .env.local (script no-ops otherwise)
 *   - the Inngest dev server running (`npx inngest-cli@latest dev`) alongside `npm run dev`
 *
 * ADR-001 Decision 5: the all-tenants sweep only queues tenants with
 * tenants.ai_enabled = true — defense in depth so this script doesn't fan
 * thousands of no-op events out to every tenant the moment AI_INGESTION_ENABLED
 * flips on. The real guarantee lives in kb-ingest.ts itself (every path
 * converges there); --tenant <id> is left unfiltered on purpose so a
 * developer can target a disabled tenant directly to prove that gate holds.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { isIngestionEnabled } from "../src/lib/ai/flag";
import { inngest } from "../src/lib/ai/ingestion/inngest";
import { scopedClientForTenant } from "../src/lib/supabase/scoped";
import { createServiceClient } from "../src/lib/supabase/server";

const tenantArgIndex = process.argv.indexOf("--tenant");
const onlyTenantId = tenantArgIndex !== -1 ? process.argv[tenantArgIndex + 1] : undefined;

async function getTenantIds(): Promise<{ ids: string[]; skippedCount: number }> {
  if (onlyTenantId) return { ids: [onlyTenantId], skippedCount: 0 };
  const raw = await createServiceClient();
  const { data, error } = await raw.from("tenants").select("id, ai_enabled");
  if (error) throw new Error(`Failed to list tenants: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; ai_enabled: boolean }>;
  const enabled = rows.filter((t) => t.ai_enabled);
  return { ids: enabled.map((t) => t.id), skippedCount: rows.length - enabled.length };
}

const STUCK_THRESHOLD_MINUTES = 15;

async function backfillTenant(tenantId: string): Promise<number> {
  const db = await scopedClientForTenant(tenantId);
  const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("knowledge_base_items")
    .select("id")
    .or(
      `and(status.eq.ready,chunk_count.is.null),and(status.in.(pending,processing),updated_at.lt.${stuckBefore})`,
    );

  if (error) throw new Error(`Failed to query tenant ${tenantId}: ${error.message}`);
  const items = (data ?? []) as unknown as Array<{ id: string }>;

  for (const item of items) {
    await inngest.send({ name: "kb/item.ingest.requested", data: { tenantId, itemId: item.id } });
  }

  return items.length;
}

async function main() {
  if (!isIngestionEnabled()) {
    console.log("AI_INGESTION_ENABLED is not 'true' — nothing to do.");
    return;
  }

  const { ids: tenantIds, skippedCount } = await getTenantIds();
  if (skippedCount > 0) {
    console.log(`Skipping ${skippedCount} tenant(s) without the per-tenant AI grant (tenants.ai_enabled = false).`);
  }
  console.log(`Backfilling ${tenantIds.length} tenant(s)${onlyTenantId ? ` (--tenant ${onlyTenantId})` : ""}...`);

  let total = 0;
  for (const tenantId of tenantIds) {
    const count = await backfillTenant(tenantId);
    if (count > 0) console.log(`  tenant ${tenantId}: sent ${count} ingest event(s)`);
    total += count;
  }

  console.log(`Done. ${total} item(s) queued for ingestion across ${tenantIds.length} tenant(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
