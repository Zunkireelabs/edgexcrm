/**
 * Backfill script: sends kb/item.ingest.requested for knowledge base items
 * that are 'ready' but were never chunked (chunk_count IS NULL) — e.g. items
 * created before AI_INGESTION_ENABLED was flipped on, or a dropped send.
 *
 * Usage:
 *   npx tsx scripts/backfill-kb-ingestion.ts                # all tenants
 *   npx tsx scripts/backfill-kb-ingestion.ts --tenant <id>   # one tenant
 *
 * Requires:
 *   - AI_INGESTION_ENABLED=true in .env.local (script no-ops otherwise)
 *   - the Inngest dev server running (`npx inngest-cli@latest dev`) alongside `npm run dev`
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { isIngestionEnabled } from "../src/lib/ai/flag";
import { inngest } from "../src/lib/ai/ingestion/inngest";
import { scopedClientForTenant } from "../src/lib/supabase/scoped";
import { createServiceClient } from "../src/lib/supabase/server";

const tenantArgIndex = process.argv.indexOf("--tenant");
const onlyTenantId = tenantArgIndex !== -1 ? process.argv[tenantArgIndex + 1] : undefined;

async function getTenantIds(): Promise<string[]> {
  if (onlyTenantId) return [onlyTenantId];
  const raw = await createServiceClient();
  const { data, error } = await raw.from("tenants").select("id");
  if (error) throw new Error(`Failed to list tenants: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((t) => t.id);
}

async function backfillTenant(tenantId: string): Promise<number> {
  const db = await scopedClientForTenant(tenantId);
  const { data, error } = await db
    .from("knowledge_base_items")
    .select("id")
    .eq("status", "ready")
    .is("chunk_count", null);

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

  const tenantIds = await getTenantIds();
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
