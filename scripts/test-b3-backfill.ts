/**
 * B3 synthetic backfill test.
 * Runs against Zunkiree Labs tenant a0000000-0000-0000-0000-000000000001 ONLY.
 *
 * Cycle:
 *   1. Create 3 synthetic leads with the SAME email, different created_at, each with a note + activity.
 *   2. Dry-run → confirm 1 group / 2 absorbed reported, ZERO writes.
 *   3. Apply → 1 canonical live, 2 absorbed archived, children re-pointed, 2 lead_merges backfill rows.
 *   4. Re-apply → idempotent (0 new merges).
 *   5. Undo → all 3 leads restored, children back on their original lead.
 *   6. Cleanup → verify re-query → 0 rows.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { runBackfill, undoBackfill } from "../src/lib/leads/backfill";
import type { BackfillReport, BackfillApplyResult } from "../src/lib/leads/backfill";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ZUNKIREE_TENANT = "a0000000-0000-0000-0000-000000000001";
const ADMIN_USER_ID = "d23c24e2-8242-42b6-9a6f-bcab8c0cfb18";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
type Supa = typeof supabase;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function run() {
  console.log("=== B3 Synthetic Backfill Test ===\n");

  const { data: pipeline } = await supabase.from("pipelines").select("id").eq("tenant_id", ZUNKIREE_TENANT).eq("is_default", true).limit(1).single();
  const { data: stage } = await supabase.from("pipeline_stages").select("id").eq("pipeline_id", (pipeline as { id: string }).id).eq("is_default", true).limit(1).single();
  const pipelineId = (pipeline as { id: string }).id;
  const stageId = (stage as { id: string }).id;

  // ── Step 1: Create 3 leads sharing the same email, different created_at ────
  const sharedEmail = "b3-test-backfill@synthetic.invalid";

  const { data: l1 } = await supabase.from("leads").insert({
    tenant_id: ZUNKIREE_TENANT, pipeline_id: pipelineId, stage_id: stageId,
    first_name: "B3", last_name: "Oldest", email: sharedEmail,
    phone: "+1-111", is_final: true, status: "new",
    custom_fields: { original: "oldest" },
    created_at: new Date("2024-01-01T10:00:00Z").toISOString(),
  }).select("id, created_at").single();

  const { data: l2 } = await supabase.from("leads").insert({
    tenant_id: ZUNKIREE_TENANT, pipeline_id: pipelineId, stage_id: stageId,
    first_name: "B3", last_name: "Middle", email: sharedEmail,
    phone: "+1-222", is_final: true, status: "new",
    created_at: new Date("2024-06-01T10:00:00Z").toISOString(),
  }).select("id, created_at").single();

  const { data: l3 } = await supabase.from("leads").insert({
    tenant_id: ZUNKIREE_TENANT, pipeline_id: pipelineId, stage_id: stageId,
    first_name: "B3", last_name: "Newest", email: sharedEmail,
    phone: "+1-333", is_final: true, status: "new",
    created_at: new Date("2024-12-01T10:00:00Z").toISOString(),
  }).select("id, created_at").single();

  const id1 = (l1 as { id: string }).id;  // oldest → canonical
  const id2 = (l2 as { id: string }).id;
  const id3 = (l3 as { id: string }).id;
  console.log(`Oldest  (canonical): ${id1}`);
  console.log(`Middle  (absorbed1): ${id2}`);
  console.log(`Newest  (absorbed2): ${id3}`);

  // Add a note + activity to each
  for (const [lid, label] of [[id1, "oldest"], [id2, "middle"], [id3, "newest"]] as [string, string][]) {
    await supabase.from("lead_notes").insert({ lead_id: lid, user_id: ADMIN_USER_ID, user_email: "admin@zunkireelabs.com", content: `note-${label}` });
    await supabase.from("lead_activities").insert({ tenant_id: ZUNKIREE_TENANT, lead_id: lid, user_id: ADMIN_USER_ID, activity_type: "call", subject: `activity-${label}` });
  }
  console.log("Notes + activities created\n");

  // ── Step 2: Dry-run — MUST write nothing ───────────────────────────────────
  console.log("=== Step 2: Dry-run ===");
  const dryResult = await runBackfill(supabase as Supa as Parameters<typeof runBackfill>[0], {
    apply: false,
    tenantId: ZUNKIREE_TENANT,
  }) as BackfillReport;

  assert(dryResult.totalGroups >= 1, `Dry-run should find at least 1 group, got ${dryResult.totalGroups}`);
  const ourGroup = dryResult.sample.find(g => g.normalizedEmail === sharedEmail.toLowerCase());
  assert(!!ourGroup, `Dry-run should include group for ${sharedEmail}`);
  assert(ourGroup!.absorbedIds.length === 2, `Group should have 2 absorbed, got ${ourGroup!.absorbedIds.length}`);
  assert(ourGroup!.canonicalId === id1, `Canonical should be oldest lead ${id1}, got ${ourGroup!.canonicalId}`);
  console.log(`✓ Dry-run: ${dryResult.totalGroups} group(s), ${dryResult.totalAbsorbed} absorbed`);
  console.log(`  Our group: canonical=${ourGroup!.canonicalId.slice(0,8)}…, absorbed=[${ourGroup!.absorbedIds.map(id=>id.slice(0,8)+'…').join(', ')}]`);

  // Verify dry-run wrote nothing — all 3 leads still live
  const { data: liveLeads } = await supabase.from("leads").select("id, deleted_at, merged_into").in("id", [id1, id2, id3]).is("deleted_at", null).is("merged_into", null);
  assert((liveLeads ?? []).length === 3, `Dry-run must not write anything — expected 3 live leads, got ${(liveLeads ?? []).length}`);
  console.log("✓ Dry-run wrote nothing — all 3 leads still live\n");

  // ── Step 3: Apply ──────────────────────────────────────────────────────────
  console.log("=== Step 3: Apply ===");
  const applyResult = await runBackfill(supabase as Supa as Parameters<typeof runBackfill>[0], {
    apply: true,
    tenantId: ZUNKIREE_TENANT,
  }) as BackfillApplyResult;

  assert(applyResult.errors.length === 0, `Apply should have 0 errors, got: ${JSON.stringify(applyResult.errors)}`);
  assert(applyResult.merged >= 2, `Should have merged at least 2, got ${applyResult.merged}`);
  console.log(`✓ Apply: merged=${applyResult.merged}, skipped=${applyResult.skipped}, errors=${applyResult.errors.length}`);

  // Verify: canonical live, absorbed archived
  const { data: afterApply } = await supabase.from("leads").select("id, deleted_at, merged_into").in("id", [id1, id2, id3]);
  const canonicalRow = (afterApply ?? []).find(r => r.id === id1);
  const abs2Row = (afterApply ?? []).find(r => r.id === id2);
  const abs3Row = (afterApply ?? []).find(r => r.id === id3);
  assert(canonicalRow?.deleted_at === null, "Canonical should be live");
  assert(abs2Row?.deleted_at !== null, "Absorbed middle should be soft-deleted");
  assert(abs3Row?.deleted_at !== null, "Absorbed newest should be soft-deleted");
  assert(abs2Row?.merged_into === id1, "Middle merged_into should point to canonical");
  assert(abs3Row?.merged_into === id1, "Newest merged_into should point to canonical");
  console.log("✓ Canonical live, 2 absorbed archived with merged_into set");

  // Verify children re-pointed to canonical
  const { data: notesOnCanon } = await supabase.from("lead_notes").select("id").eq("lead_id", id1);
  assert((notesOnCanon ?? []).length === 3, `All 3 notes should be on canonical, got ${(notesOnCanon ?? []).length}`);
  const { data: actsOnCanon } = await supabase.from("lead_activities").select("id").eq("lead_id", id1);
  assert((actsOnCanon ?? []).length === 3, `All 3 activities should be on canonical, got ${(actsOnCanon ?? []).length}`);
  console.log("✓ All 3 notes + 3 activities now on canonical");

  // Verify 2 synthesized submissions + 2 lead_merges source=backfill rows
  const { data: mergeRows } = await supabase.from("lead_merges").select("id, source, absorbed_id, undone_at").eq("canonical_id", id1).eq("source", "backfill").is("undone_at", null);
  assert((mergeRows ?? []).length === 2, `Should have 2 backfill merge rows, got ${(mergeRows ?? []).length}`);
  console.log(`✓ 2 lead_merges source='backfill' rows written`);

  // ── Step 4: Re-apply — idempotent ─────────────────────────────────────────
  console.log("\n=== Step 4: Re-apply (idempotency) ===");
  const reapplyResult = await runBackfill(supabase as Supa as Parameters<typeof runBackfill>[0], {
    apply: true,
    tenantId: ZUNKIREE_TENANT,
  }) as BackfillApplyResult;

  assert(reapplyResult.merged === 0, `Re-apply should merge 0, got ${reapplyResult.merged}`);
  assert(reapplyResult.errors.length === 0, `Re-apply should have 0 errors`);
  console.log(`✓ Re-apply idempotent: merged=${reapplyResult.merged}, skipped=${reapplyResult.skipped}`);

  // ── Step 5: Undo ───────────────────────────────────────────────────────────
  console.log("\n=== Step 5: Undo ===");
  const undoResult = await undoBackfill(supabase as Supa as Parameters<typeof undoBackfill>[0], { tenantId: ZUNKIREE_TENANT });
  assert(undoResult.errors.length === 0, `Undo should have 0 errors, got: ${JSON.stringify(undoResult.errors)}`);
  assert(undoResult.undone >= 2, `Undo should reverse at least 2 merges, got ${undoResult.undone}`);
  console.log(`✓ Undo: undone=${undoResult.undone}, errors=${undoResult.errors.length}`);

  // Verify all 3 leads restored
  const { data: afterUndo } = await supabase.from("leads").select("id, deleted_at, merged_into").in("id", [id1, id2, id3]);
  for (const row of (afterUndo ?? [])) {
    assert(row.deleted_at === null, `After undo, lead ${row.id.slice(0,8)}… should be live`);
    assert(row.merged_into === null, `After undo, lead ${row.id.slice(0,8)}… merged_into should be null`);
  }
  console.log("✓ All 3 leads restored (deleted_at=null, merged_into=null)");

  // Verify notes/activities distributed back — each lead should have 1 note and 1 activity
  for (const [lid, label] of [[id1, "oldest"], [id2, "middle"], [id3, "newest"]] as [string, string][]) {
    const { data: n } = await supabase.from("lead_notes").select("id").eq("lead_id", lid);
    const { data: a } = await supabase.from("lead_activities").select("id").eq("lead_id", lid);
    assert((n ?? []).length === 1, `${label} should have 1 note after undo, got ${(n ?? []).length}`);
    assert((a ?? []).length === 1, `${label} should have 1 activity after undo, got ${(a ?? []).length}`);
  }
  console.log("✓ Notes + activities restored to original leads\n");

  // ── Step 6: Cleanup ────────────────────────────────────────────────────────
  console.log("=== Cleanup ===");

  // Delete in dependency order
  await supabase.from("lead_merges").delete().eq("canonical_id", id1);
  await supabase.from("lead_merges").delete().in("absorbed_id", [id2, id3]);
  await supabase.from("lead_submissions").delete().in("lead_id", [id1, id2, id3]);
  await supabase.from("lead_notes").delete().in("lead_id", [id1, id2, id3]);
  await supabase.from("lead_activities").delete().in("lead_id", [id1, id2, id3]);

  // Soft-deleted leads need deleted_at cleared for hard-delete via RLS bypass (service key)
  const { error: delErr } = await supabase.from("leads").delete().in("id", [id1, id2, id3]);
  assert(!delErr, `Delete leads failed: ${delErr?.message}`);

  // Verify cleanup succeeded — re-query → 0
  const { data: leftoverLeads } = await supabase.from("leads").select("id").in("id", [id1, id2, id3]);
  assert((leftoverLeads ?? []).length === 0, `Cleanup failed — ${(leftoverLeads ?? []).length} leads remain`);
  console.log("✓ leads: 0 rows remaining");

  const { data: leftoverNotes } = await supabase.from("lead_notes").select("id").in("lead_id", [id1, id2, id3]);
  assert((leftoverNotes ?? []).length === 0, `Notes cleanup failed — ${(leftoverNotes ?? []).length} remain`);
  console.log("✓ lead_notes: 0 rows remaining");

  const { data: leftoverActs } = await supabase.from("lead_activities").select("id").in("lead_id", [id1, id2, id3]);
  assert((leftoverActs ?? []).length === 0, `Activities cleanup failed — ${(leftoverActs ?? []).length} remain`);
  console.log("✓ lead_activities: 0 rows remaining");

  console.log("\n=== ALL B3 ASSERTIONS PASSED ✓ ===");
}

run().catch((err) => { console.error("\n✗ TEST FAILED:", err.message ?? err); process.exit(1); });
