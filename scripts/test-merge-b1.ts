/**
 * Synthetic round-trip test for Phase B1 merge primitive.
 * Runs against the Zunkiree Labs tenant (a0000000-0000-0000-0000-000000000001) only.
 * Creates two fake leads, merges them, asserts state, undoes, asserts again, then cleans up.
 * Checks:
 *   - absorbed soft-deleted + merged_into set
 *   - notes/activities re-pointed to canonical
 *   - synthesized lead_submissions row created
 *   - lead_merges row written with {old,new} field_patch
 *   - canonical's custom_fields/tags/file_urls are the merged superset (NOT corrupted)
 *   - undo restores absorbed, moves children back, cleans synthesized row
 *   - undo restores canonical's original custom_fields/tags/file_urls (regression check for #1)
 *   - cross-tenant undo is rejected as not-found (check for #2)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mergeLeads, undoMerge } from "../src/lib/leads/merge";

// ── config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ZUNKIREE_TENANT = "a0000000-0000-0000-0000-000000000001";
const ZUNKIREE_ADMIN_USER_ID = "d23c24e2-8242-42b6-9a6f-bcab8c0cfb18";
const ZUNKIREE_ADMIN_EMAIL = "admin@zunkireelabs.com";
// Use a real pipeline from Zunkiree Labs tenant
let PIPELINE_ID = "";
let STAGE_ID = "";

// ── helpers ──────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== Phase B1 Synthetic Merge Round-Trip Test ===\n");

  // Resolve pipeline + default stage
  const { data: pipelines } = await supabase
    .from("pipelines")
    .select("id")
    .eq("tenant_id", ZUNKIREE_TENANT)
    .eq("is_default", true)
    .limit(1);
  if (!pipelines?.length) throw new Error("No default pipeline for Zunkiree Labs tenant");
  PIPELINE_ID = (pipelines[0] as { id: string }).id;

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", PIPELINE_ID)
    .eq("is_default", true)
    .limit(1);
  if (!stages?.length) throw new Error("No default stage for pipeline");
  STAGE_ID = (stages[0] as { id: string }).id;

  console.log(`Using pipeline ${PIPELINE_ID}, stage ${STAGE_ID}\n`);

  // ── Step 1: Create two synthetic leads ─────────────────────────────────────
  // Canonical has pre-existing custom_fields, tags, file_urls.
  // Absorbed has different custom_fields/tags that should merge into canonical.

  const canonicalPayload = {
    tenant_id: ZUNKIREE_TENANT,
    pipeline_id: PIPELINE_ID,
    stage_id: STAGE_ID,
    first_name: "Test",
    last_name: "Canonical",
    email: "test-canonical-b1@synthetic.invalid",
    is_final: true,
    status: "new",
    tags: ["keep", "original"],
    custom_fields: { a: 1, existing_key: "canonical-value" },
    file_urls: { doc1: "https://example.com/canonical-doc.pdf" },
  };

  const absorbedPayload = {
    tenant_id: ZUNKIREE_TENANT,
    pipeline_id: PIPELINE_ID,
    stage_id: STAGE_ID,
    first_name: "Test",
    last_name: "Absorbed",
    email: "test-absorbed-b1@synthetic.invalid",
    phone: "+1-5551234567",           // will fill canonical's empty phone
    is_final: true,
    status: "new",
    tags: ["absorbed-tag"],
    custom_fields: { b: 2, existing_key: "absorbed-value" }, // existing_key should NOT override canonical
    file_urls: { doc2: "https://example.com/absorbed-doc.pdf" },
  };

  const { data: canonical, error: canonErr } = await supabase
    .from("leads")
    .insert(canonicalPayload)
    .select("*")
    .single();
  if (canonErr || !canonical) throw new Error(`Failed to create canonical: ${canonErr?.message}`);

  const { data: absorbed, error: absErr } = await supabase
    .from("leads")
    .insert(absorbedPayload)
    .select("*")
    .single();
  if (absErr || !absorbed) throw new Error(`Failed to create absorbed: ${absErr?.message}`);

  const canonicalId = (canonical as { id: string }).id;
  const absorbedId = (absorbed as { id: string }).id;
  console.log(`Created canonical: ${canonicalId}`);
  console.log(`Created absorbed:  ${absorbedId}`);

  // ── Step 2: Add a note + activity to each lead ─────────────────────────────
  const { data: canonNote, error: cnErr } = await supabase
    .from("lead_notes")
    .insert({ lead_id: canonicalId, user_id: ZUNKIREE_ADMIN_USER_ID, user_email: ZUNKIREE_ADMIN_EMAIL, content: "canonical note" })
    .select("id").single();
  if (cnErr || !canonNote) throw new Error(`Failed to create canonical note: ${cnErr?.message}`);

  const { data: absNote, error: anErr } = await supabase
    .from("lead_notes")
    .insert({ lead_id: absorbedId, user_id: ZUNKIREE_ADMIN_USER_ID, user_email: ZUNKIREE_ADMIN_EMAIL, content: "absorbed note" })
    .select("id").single();
  if (anErr || !absNote) throw new Error(`Failed to create absorbed note: ${anErr?.message}`);

  const { data: canonAct, error: caErr } = await supabase
    .from("lead_activities")
    .insert({ tenant_id: ZUNKIREE_TENANT, lead_id: canonicalId, user_id: ZUNKIREE_ADMIN_USER_ID, activity_type: "call", subject: "canonical activity" })
    .select("id").single();
  if (caErr || !canonAct) throw new Error(`Failed to create canonical activity: ${caErr?.message}`);

  const { data: absAct, error: aaErr } = await supabase
    .from("lead_activities")
    .insert({ tenant_id: ZUNKIREE_TENANT, lead_id: absorbedId, user_id: ZUNKIREE_ADMIN_USER_ID, activity_type: "call", subject: "absorbed activity" })
    .select("id").single();
  if (aaErr || !absAct) throw new Error(`Failed to create absorbed activity: ${aaErr?.message}`);

  const canonNoteId = (canonNote as { id: string }).id;
  const absNoteId = (absNote as { id: string }).id;
  const canonActId = (canonAct as { id: string }).id;
  const absActId = (absAct as { id: string }).id;
  console.log(`Notes: canonical=${canonNoteId}, absorbed=${absNoteId}`);
  console.log(`Activities: canonical=${canonActId}, absorbed=${absActId}\n`);

  // ── Step 3: Merge ───────────────────────────────────────────────────────────
  console.log("=== POST /api/v1/leads/merge (simulated) ===");
  const mergeResult = await mergeLeads(supabase as Parameters<typeof mergeLeads>[0], {
    tenantId: ZUNKIREE_TENANT,
    canonicalId,
    absorbedId,
    mergedBy: null,
    source: "manual",
  });

  console.log(`mergeId: ${mergeResult.mergeId}`);
  console.log(`repointedCounts: ${JSON.stringify(mergeResult.repointedCounts)}\n`);

  // Fetch post-merge state
  const { data: absorbedPost } = await supabase.from("leads").select("*").eq("id", absorbedId).single();
  const { data: canonicalPost } = await supabase.from("leads").select("*").eq("id", canonicalId).single();
  const { data: mergeRow } = await supabase.from("lead_merges").select("*").eq("id", mergeResult.mergeId).single();

  // Assertions
  assert((absorbedPost as { deleted_at: string | null }).deleted_at !== null, "absorbed.deleted_at should be set");
  assert((absorbedPost as { merged_into: string | null }).merged_into === canonicalId, "absorbed.merged_into should be canonicalId");
  console.log("✓ Absorbed lead soft-deleted with merged_into set");

  // Notes: absorbed's note should be on canonical now
  const { data: notesOnCanon } = await supabase.from("lead_notes").select("id").eq("lead_id", canonicalId);
  const { data: notesOnAbsorbed } = await supabase.from("lead_notes").select("id").eq("lead_id", absorbedId);
  const canonNoteIds = ((notesOnCanon ?? []) as { id: string }[]).map(r => r.id);
  const absNoteIds = ((notesOnAbsorbed ?? []) as { id: string }[]).map(r => r.id);
  assert(canonNoteIds.includes(canonNoteId), "canonical's own note should remain on canonical");
  assert(canonNoteIds.includes(absNoteId), "absorbed's note should be re-pointed to canonical");
  assert(absNoteIds.length === 0, "no notes should remain on absorbed");
  console.log("✓ Notes re-pointed correctly");

  // Activities: absorbed's activity should be on canonical
  const { data: actsOnCanon } = await supabase.from("lead_activities").select("id").eq("lead_id", canonicalId);
  const canonActIds = ((actsOnCanon ?? []) as { id: string }[]).map(r => r.id);
  assert(canonActIds.includes(canonActId), "canonical's own activity should remain on canonical");
  assert(canonActIds.includes(absActId), "absorbed's activity should be re-pointed to canonical");
  console.log("✓ Activities re-pointed correctly");

  // Synthesized submission
  const { data: synthSub } = await supabase
    .from("lead_submissions")
    .select("*")
    .eq("id", (mergeRow as { synthesized_submission_id: string }).synthesized_submission_id)
    .single();
  assert(synthSub !== null, "synthesized lead_submissions row should exist");
  assert((synthSub as { lead_id: string }).lead_id === canonicalId, "synthesized submission should be on canonical");
  console.log("✓ Synthesized submission created");

  // field_patch shape: {old, new}
  const fp = (mergeRow as { field_patch: Record<string, unknown> }).field_patch as Record<string, { old: unknown; new: unknown }>;
  const fpKeys = Object.keys(fp);
  assert(fpKeys.length > 0, "field_patch should have at least one key (phone should have been merged)");
  for (const key of fpKeys) {
    assert(typeof fp[key] === "object" && fp[key] !== null && "old" in fp[key] && "new" in fp[key],
      `field_patch key "${key}" should be {old, new} shape, got: ${JSON.stringify(fp[key])}`);
  }
  console.log(`✓ field_patch has {old, new} shape for keys: ${fpKeys.join(", ")}`);

  // Canonical's custom_fields: should be merged superset (canonical wins on existing_key)
  const cf = (canonicalPost as { custom_fields: Record<string, unknown> }).custom_fields;
  assert(cf.a === 1, "canonical should still have custom_fields.a=1 from original");
  assert(cf.b === 2, "canonical should have custom_fields.b=2 from absorbed");
  assert(cf.existing_key === "canonical-value", "canonical's existing_key should win over absorbed");
  console.log(`✓ custom_fields merged correctly: ${JSON.stringify(cf)}`);

  // Canonical's tags: union
  const tags = (canonicalPost as { tags: string[] }).tags;
  assert(tags.includes("keep") && tags.includes("original"), "canonical's original tags preserved");
  assert(tags.includes("absorbed-tag"), "absorbed's tag added to union");
  console.log(`✓ tags union correct: ${JSON.stringify(tags)}`);

  // Canonical's file_urls: merged superset
  const fu = (canonicalPost as { file_urls: Record<string, unknown> }).file_urls;
  assert("doc1" in fu, "canonical's original doc1 preserved");
  assert("doc2" in fu, "absorbed's doc2 merged in");
  console.log(`✓ file_urls merged correctly: ${JSON.stringify(fu)}`);

  // Canonical's phone filled from absorbed
  assert((canonicalPost as { phone: string | null }).phone !== null, "canonical phone filled from absorbed");
  console.log(`✓ canonical.phone filled: ${(canonicalPost as { phone: string | null }).phone}`);

  // lead_merges row undone_at is null
  assert((mergeRow as { undone_at: string | null }).undone_at === null, "merge undone_at should be null");
  console.log("✓ lead_merges row written correctly\n");

  // ── Step 4: Undo ────────────────────────────────────────────────────────────
  console.log("=== POST /api/v1/leads/merge/:mergeId/undo (simulated) ===");
  const undoResult = await undoMerge(
    supabase as Parameters<typeof undoMerge>[0],
    mergeResult.mergeId,
    ZUNKIREE_TENANT,
    null
  );
  assert(undoResult.restoredAbsorbedId === absorbedId, "undo should restore absorbed");
  assert(undoResult.canonicalId === canonicalId, "undo should reference canonical");
  console.log("Undo completed\n");

  // Fetch post-undo state
  const { data: absorbedUndo } = await supabase.from("leads").select("*").eq("id", absorbedId).single();
  const { data: canonicalUndo } = await supabase.from("leads").select("*").eq("id", canonicalId).single();
  const { data: mergeRowUndo } = await supabase.from("lead_merges").select("*").eq("id", mergeResult.mergeId).single();

  // Absorbed restored
  assert((absorbedUndo as { deleted_at: string | null }).deleted_at === null, "absorbed.deleted_at should be cleared");
  assert((absorbedUndo as { merged_into: string | null }).merged_into === null, "absorbed.merged_into should be cleared");
  console.log("✓ Absorbed lead restored");

  // Notes back on absorbed
  const { data: notesOnCanonUndo } = await supabase.from("lead_notes").select("id").eq("lead_id", canonicalId);
  const { data: notesOnAbsorbedUndo } = await supabase.from("lead_notes").select("id").eq("lead_id", absorbedId);
  const canonNoteIdsUndo = ((notesOnCanonUndo ?? []) as { id: string }[]).map(r => r.id);
  const absNoteIdsUndo = ((notesOnAbsorbedUndo ?? []) as { id: string }[]).map(r => r.id);
  assert(canonNoteIdsUndo.includes(canonNoteId), "canonical's own note should stay on canonical after undo");
  assert(!canonNoteIdsUndo.includes(absNoteId), "absorbed's note should NOT be on canonical after undo");
  assert(absNoteIdsUndo.includes(absNoteId), "absorbed's note should be back on absorbed after undo");
  console.log("✓ Notes restored correctly");

  // Activities back on absorbed
  const { data: actsOnCanonUndo } = await supabase.from("lead_activities").select("id").eq("lead_id", canonicalId);
  const { data: actsOnAbsorbedUndo } = await supabase.from("lead_activities").select("id").eq("lead_id", absorbedId);
  const canonActIdsUndo = ((actsOnCanonUndo ?? []) as { id: string }[]).map(r => r.id);
  const absActIdsUndo = ((actsOnAbsorbedUndo ?? []) as { id: string }[]).map(r => r.id);
  assert(canonActIdsUndo.includes(canonActId), "canonical's own activity stays on canonical");
  assert(!canonActIdsUndo.includes(absActId), "absorbed's activity should NOT be on canonical after undo");
  assert(absActIdsUndo.includes(absActId), "absorbed's activity should be back on absorbed");
  console.log("✓ Activities restored correctly");

  // Synthesized submission deleted
  const { data: synthSubUndo } = await supabase
    .from("lead_submissions")
    .select("id")
    .eq("id", (mergeRow as { synthesized_submission_id: string }).synthesized_submission_id)
    .maybeSingle();
  assert(synthSubUndo === null, "synthesized submission should be deleted on undo");
  console.log("✓ Synthesized submission deleted on undo");

  // lead_merges.undone_at set
  assert((mergeRowUndo as { undone_at: string | null }).undone_at !== null, "merge undone_at should be set after undo");
  console.log("✓ lead_merges.undone_at set");

  // ── KEY REGRESSION CHECK (#1): canonical's original values restored ─────────
  const cfUndo = (canonicalUndo as { custom_fields: Record<string, unknown> }).custom_fields;
  const tagsUndo = (canonicalUndo as { tags: string[] }).tags;
  const fuUndo = (canonicalUndo as { file_urls: Record<string, unknown> }).file_urls;

  assert(deepEqual(cfUndo, { a: 1, existing_key: "canonical-value" }),
    `custom_fields should be restored to original {a:1, existing_key:"canonical-value"}, got: ${JSON.stringify(cfUndo)}`);
  assert(deepEqual(tagsUndo.sort(), ["keep", "original"].sort()),
    `tags should be restored to original ["keep", "original"], got: ${JSON.stringify(tagsUndo)}`);
  assert(deepEqual(fuUndo, { doc1: "https://example.com/canonical-doc.pdf" }),
    `file_urls should be restored to original {doc1:...}, got: ${JSON.stringify(fuUndo)}`);
  console.log("✓ custom_fields restored to original:", JSON.stringify(cfUndo));
  console.log("✓ tags restored to original:", JSON.stringify(tagsUndo));
  console.log("✓ file_urls restored to original:", JSON.stringify(fuUndo));
  console.log("✓ #1 REGRESSION CHECK PASSED — canonical JSONB/array fields survived undo\n");

  // ── Cross-tenant check (#2) ─────────────────────────────────────────────────
  console.log("=== Cross-tenant undo rejection check (#2) ===");
  // Create a second synthetic merge so we have a valid mergeId to attempt cross-tenant undo on
  // We'll reuse the same leads (they're restored now) for a second merge
  const merge2 = await mergeLeads(supabase as Parameters<typeof mergeLeads>[0], {
    tenantId: ZUNKIREE_TENANT,
    canonicalId,
    absorbedId,
    mergedBy: null,
    source: "manual",
  });

  const FAKE_OTHER_TENANT = "b0000000-0000-0000-0000-000000000002";
  let crossTenantRejected = false;
  try {
    await undoMerge(
      supabase as Parameters<typeof undoMerge>[0],
      merge2.mergeId,
      FAKE_OTHER_TENANT,  // wrong tenant
      null
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) {
      crossTenantRejected = true;
      console.log(`✓ #2 Cross-tenant undo rejected with "not found": ${msg}`);
    } else {
      console.log(`✗ Unexpected error (not "not found"): ${msg}`);
    }
  }
  assert(crossTenantRejected, "#2: cross-tenant undo should be rejected as not-found");

  // Undo the second merge properly to restore state for cleanup
  await undoMerge(
    supabase as Parameters<typeof undoMerge>[0],
    merge2.mergeId,
    ZUNKIREE_TENANT,
    null
  );
  console.log("✓ #2 check passed — cross-tenant undo correctly rejected\n");

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  console.log("=== Cleanup ===");
  // Delete lead_merges rows for these leads
  await supabase.from("lead_merges").delete().eq("canonical_id", canonicalId);
  await supabase.from("lead_merges").delete().eq("absorbed_id", absorbedId);
  // Delete notes + activities
  await supabase.from("lead_notes").delete().in("id", [canonNoteId, absNoteId]);
  await supabase.from("lead_activities").delete().in("id", [canonActId, absActId]);
  // Delete lead_submissions for these leads
  await supabase.from("lead_submissions").delete().eq("lead_id", canonicalId);
  await supabase.from("lead_submissions").delete().eq("lead_id", absorbedId);
  // Delete leads
  await supabase.from("leads").delete().eq("id", canonicalId);
  await supabase.from("leads").delete().eq("id", absorbedId);
  console.log("✓ Synthetic test rows cleaned up\n");

  console.log("=== ALL ASSERTIONS PASSED ✓ ===");
}

run().catch(err => {
  console.error("\n✗ TEST FAILED:", err.message);
  process.exit(1);
});
