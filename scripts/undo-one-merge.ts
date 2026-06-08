/**
 * One-off: undo a single lead merge by id (used to reverse a manual UI merge so the
 * sadin group can be re-collapsed fresh through the B4 merge path). Reversible op.
 *   npx tsx scripts/undo-one-merge.ts <mergeId> <tenantId>
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { undoMerge } from "../src/lib/leads/merge";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const mergeId = process.argv[2];
const tenantId = process.argv[3];
if (!mergeId || !tenantId) {
  console.error("Usage: npx tsx scripts/undo-one-merge.ts <mergeId> <tenantId>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const res = await undoMerge(supabase as Parameters<typeof undoMerge>[0], mergeId, tenantId, null);
  console.log("✓ Undone:", JSON.stringify(res));
}

main().catch((e) => {
  console.error("✗ Undo failed:", e.message ?? e);
  process.exit(1);
});
