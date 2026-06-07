/**
 * B2 synthetic test — phone duplicate suggestions + dismiss.
 * Runs against Zunkiree Labs tenant a0000000-0000-0000-0000-000000000001 only.
 * Verifies cleanup succeeded by re-querying after deletion.
 */

import { createClient } from "@supabase/supabase-js";
import { recordDuplicateSuggestions } from "../src/lib/leads/dedup";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ZUNKIREE_TENANT = "a0000000-0000-0000-0000-000000000001";
const ZUNKIREE_ADMIN_USER_ID = "d23c24e2-8242-42b6-9a6f-bcab8c0cfb18";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function run() {
  console.log("=== B2 Synthetic Test — Phone Suggestions ===\n");

  // Get default pipeline + stage
  const { data: pipeline } = await supabase.from("pipelines").select("id").eq("tenant_id", ZUNKIREE_TENANT).eq("is_default", true).limit(1).single();
  const { data: stage } = await supabase.from("pipeline_stages").select("id").eq("pipeline_id", (pipeline as { id: string }).id).eq("is_default", true).limit(1).single();
  const pipelineId = (pipeline as { id: string }).id;
  const stageId = (stage as { id: string }).id;

  // Step 1: Create 2 leads with DIFFERENT emails but SAME phone suffix
  const sharedPhone = "+1-5559876543";
  const { data: lead1, error: e1 } = await supabase.from("leads").insert({
    tenant_id: ZUNKIREE_TENANT, pipeline_id: pipelineId, stage_id: stageId,
    first_name: "B2Test", last_name: "Alpha", email: "b2test-alpha@synthetic.invalid",
    phone: sharedPhone, is_final: true, status: "new",
  }).select("*").single();
  if (e1 || !lead1) throw new Error(`Lead1 create failed: ${e1?.message}`);

  const { data: lead2, error: e2 } = await supabase.from("leads").insert({
    tenant_id: ZUNKIREE_TENANT, pipeline_id: pipelineId, stage_id: stageId,
    first_name: "B2Test", last_name: "Beta", email: "b2test-beta@synthetic.invalid",
    phone: sharedPhone, is_final: true, status: "new",
  }).select("*").single();
  if (e2 || !lead2) throw new Error(`Lead2 create failed: ${e2?.message}`);

  const lead1Id = (lead1 as { id: string }).id;
  const lead2Id = (lead2 as { id: string }).id;
  console.log(`Created lead1: ${lead1Id}`);
  console.log(`Created lead2: ${lead2Id}`);

  // Step 2: Call recordDuplicateSuggestions as the ingestion path would
  await recordDuplicateSuggestions(supabase as Parameters<typeof recordDuplicateSuggestions>[0], {
    tenantId: ZUNKIREE_TENANT,
    leadId: lead1Id,
    suggestedLeadIds: [lead2Id],
    reason: "phone",
  });
  console.log("recordDuplicateSuggestions called");

  // Verify suggestion was created
  const { data: sugg } = await supabase
    .from("lead_duplicate_suggestions")
    .select("*")
    .eq("tenant_id", ZUNKIREE_TENANT)
    .eq("lead_id", lead1Id)
    .eq("suggested_lead_id", lead2Id)
    .eq("status", "open")
    .maybeSingle();

  assert(sugg !== null, "lead_duplicate_suggestions row should exist (status=open)");
  const suggId = (sugg as { id: string }).id;
  console.log(`✓ Suggestion created: ${suggId} (reason=${(sugg as { reason: string }).reason}, status=${(sugg as { status: string }).status})`);

  // Step 3: onConflict DO NOTHING — calling again should not create a duplicate
  await recordDuplicateSuggestions(supabase as Parameters<typeof recordDuplicateSuggestions>[0], {
    tenantId: ZUNKIREE_TENANT,
    leadId: lead1Id,
    suggestedLeadIds: [lead2Id],
    reason: "phone",
  });
  const { data: suggs2 } = await supabase
    .from("lead_duplicate_suggestions")
    .select("id")
    .eq("tenant_id", ZUNKIREE_TENANT)
    .eq("lead_id", lead1Id)
    .eq("suggested_lead_id", lead2Id);
  assert((suggs2 ?? []).length === 1, "onConflict DO NOTHING — should still be exactly 1 suggestion");
  console.log("✓ onConflict DO NOTHING works — no duplicate created");

  // Step 4: Add a note to lead1 (to test that suggestions view note child data)
  await supabase.from("lead_notes").insert({
    lead_id: lead1Id,
    user_id: ZUNKIREE_ADMIN_USER_ID,
    user_email: "admin@zunkireelabs.com",
    content: "b2-test note on lead1",
  });

  // Step 5: GET /api/v1/leads/:id/duplicates — verify enrichment (test the query directly)
  const { data: leadSuggs } = await supabase
    .from("lead_duplicate_suggestions")
    .select("*")
    .eq("tenant_id", ZUNKIREE_TENANT)
    .eq("status", "open")
    .or(`lead_id.eq.${lead1Id},suggested_lead_id.eq.${lead1Id}`);

  assert((leadSuggs ?? []).length >= 1, "Should find at least 1 open suggestion for lead1");
  console.log(`✓ GET duplicates query returns ${(leadSuggs ?? []).length} suggestion(s)`);

  // Step 6: Dismiss the suggestion
  const { error: dismissErr } = await supabase
    .from("lead_duplicate_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggId)
    .eq("tenant_id", ZUNKIREE_TENANT);
  assert(!dismissErr, `Dismiss should succeed: ${dismissErr?.message}`);

  const { data: dismissed } = await supabase
    .from("lead_duplicate_suggestions")
    .select("status")
    .eq("id", suggId)
    .single();
  assert((dismissed as { status: string }).status === "dismissed", "status should be dismissed");
  console.log("✓ Suggestion dismissed");

  // Step 7: Re-submit same pair — should NOT resurface (onConflict DO NOTHING on dismissed row)
  await recordDuplicateSuggestions(supabase as Parameters<typeof recordDuplicateSuggestions>[0], {
    tenantId: ZUNKIREE_TENANT,
    leadId: lead1Id,
    suggestedLeadIds: [lead2Id],
    reason: "phone",
  });
  const { data: afterResubmit } = await supabase
    .from("lead_duplicate_suggestions")
    .select("status")
    .eq("id", suggId)
    .single();
  assert((afterResubmit as { status: string }).status === "dismissed", "dismissed suggestion should NOT resurface on re-submit");
  console.log("✓ Dismissed pair does not resurface on re-submit");

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log("\n=== Cleanup ===");

  // Delete suggestion
  const { error: delSugg } = await supabase.from("lead_duplicate_suggestions").delete().eq("id", suggId);
  assert(!delSugg, `Delete suggestion failed: ${delSugg?.message}`);

  // Delete notes
  await supabase.from("lead_notes").delete().eq("lead_id", lead1Id);
  await supabase.from("lead_notes").delete().eq("lead_id", lead2Id);

  // Delete lead_submissions
  await supabase.from("lead_submissions").delete().eq("lead_id", lead1Id);
  await supabase.from("lead_submissions").delete().eq("lead_id", lead2Id);

  // Delete leads
  const { error: delL1 } = await supabase.from("leads").delete().eq("id", lead1Id);
  const { error: delL2 } = await supabase.from("leads").delete().eq("id", lead2Id);
  assert(!delL1, `Delete lead1 failed: ${delL1?.message}`);
  assert(!delL2, `Delete lead2 failed: ${delL2?.message}`);

  // ── Verify cleanup succeeded (re-query → 0 rows) ───────────────────────────
  console.log("Verifying cleanup...");
  const { data: leftoverLeads } = await supabase.from("leads").select("id").in("id", [lead1Id, lead2Id]);
  assert((leftoverLeads ?? []).length === 0, `Cleanup failed — ${(leftoverLeads ?? []).length} leads still in DB`);
  console.log("✓ leads: 0 rows remaining");

  const { data: leftoverSuggs } = await supabase.from("lead_duplicate_suggestions").select("id").eq("id", suggId);
  assert((leftoverSuggs ?? []).length === 0, "Cleanup failed — suggestion still in DB");
  console.log("✓ lead_duplicate_suggestions: 0 rows remaining");

  console.log("\n=== ALL B2 ASSERTIONS PASSED ✓ ===");
}

run().catch((err) => { console.error("\n✗ TEST FAILED:", err.message); process.exit(1); });
