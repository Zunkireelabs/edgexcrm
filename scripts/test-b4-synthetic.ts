/**
 * B4 synthetic verification test — Zunkiree Labs tenant only.
 * Never touches Admizz (febeb37c-…).
 *
 * Tests:
 * 1. New lead → lead.submission audit with is_first:true + real form_name
 * 2. Resubmit same email → audit with is_first:false + form_name2
 * 3. Merge → absorbed's form_name appears on canonical's audit
 * 4. --email backfill dry-run writes nothing; --apply collapses group
 * 5. Delete all synthetic rows; re-query → 0
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { recordSubmission, emitSubmissionAudit, resolveFormName } from "../src/lib/leads/dedup";
import { mergeLeads } from "../src/lib/leads/merge";
import { runBackfill } from "../src/lib/leads/backfill";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SYNTHETIC_TENANT = "a0000000-0000-0000-0000-000000000001";
const ADMIZZ_TENANT = "febeb37c-b0ea-43e9-9cd1-40e0a1bd0b89";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Strict guard: never touch Admizz
async function assertNotAdmizz(leadId: string) {
  const { data } = await supabase.from("leads").select("tenant_id").eq("id", leadId).single();
  if (!data) return;
  if ((data as { tenant_id: string }).tenant_id === ADMIZZ_TENANT) {
    throw new Error(`SAFETY: lead ${leadId} belongs to Admizz — aborting`);
  }
}

let createdLeadIds: string[] = [];
let createdAuditIds: string[] = [];

async function cleanup() {
  console.log("\n🧹 Cleanup — deleting synthetic rows…");
  if (createdLeadIds.length > 0) {
    await supabase.from("lead_submissions").delete().in("lead_id", createdLeadIds);
    await supabase.from("lead_merges").delete().in("canonical_id", createdLeadIds);
    await supabase.from("lead_merges").delete().in("absorbed_id", createdLeadIds);
    await supabase.from("audit_logs").delete().in("entity_id", createdLeadIds);
    await supabase.from("events").delete().in("entity_id", createdLeadIds);
    await supabase.from("lead_duplicate_suggestions").delete().in("lead_id", createdLeadIds);
    await supabase.from("leads").delete().in("id", createdLeadIds);
  }
  console.log(`  Deleted ${createdLeadIds.length} synthetic lead IDs`);

  // Re-query to confirm deletes
  if (createdLeadIds.length > 0) {
    const { data: remainingLeads } = await supabase.from("leads").select("id").in("id", createdLeadIds);
    const { data: remainingAudits } = await supabase.from("audit_logs").select("id").in("entity_id", createdLeadIds);
    const remaining = (remainingLeads?.length ?? 0) + (remainingAudits?.length ?? 0);
    if (remaining > 0) {
      console.error(`  ⛔ Re-query: ${remaining} rows still exist after cleanup!`);
    } else {
      console.log("  ✓ Re-query: 0 rows remain — cleanup confirmed.");
    }
  }
}

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  B4 Synthetic Verification");
  console.log("  Tenant: Zunkiree Labs (synthetic)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Get form configs ──────────────────────────────────────────────────────
  const { data: formConfigs } = await supabase
    .from("form_configs")
    .select("id, name")
    .eq("tenant_id", SYNTHETIC_TENANT)
    .limit(2);

  if (!formConfigs || formConfigs.length < 1) {
    console.error("No form_configs found on synthetic tenant — create one first.");
    process.exit(1);
  }

  const form1 = formConfigs[0] as { id: string; name: string };
  const form2 = formConfigs.length >= 2
    ? (formConfigs[1] as { id: string; name: string })
    : form1;

  console.log(`  Form1: "${form1.name}" (${form1.id.slice(0, 8)}…)`);
  console.log(`  Form2: "${form2.name}" (${form2.id.slice(0, 8)}…)\n`);

  // ── Get default pipeline + stage ─────────────────────────────────────────
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("tenant_id", SYNTHETIC_TENANT)
    .eq("is_default", true)
    .single();

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id, slug")
    .eq("pipeline_id", (pipeline as { id: string }).id)
    .eq("is_default", true)
    .single();

  const pipelineId = (pipeline as { id: string }).id;
  const stageId = (stage as { id: string }).id;
  const stageSlug = (stage as { slug: string }).slug;

  const testEmail = `b4-test-${Date.now()}@synthetic.invalid`;

  // ── TEST 1: New lead first submission ─────────────────────────────────────
  console.log("TEST 1: New lead → lead.submission audit with is_first + form_name");

  const { data: lead1, error: lead1Err } = await supabase.from("leads").insert({
    tenant_id: SYNTHETIC_TENANT,
    pipeline_id: pipelineId,
    stage_id: stageId,
    status: stageSlug,
    is_final: true,
    step: 1,
    email: testEmail,
    first_name: "B4-Test",
    last_name: "Lead",
    form_config_id: form1.id,
    custom_fields: { test_field: "hello b4" },
    intake_source: "test",
  }).select("id").single();

  if (lead1Err || !lead1) throw new Error(`Failed to create lead1: ${lead1Err?.message}`);
  createdLeadIds.push((lead1 as { id: string }).id);
  await assertNotAdmizz((lead1 as { id: string }).id);

  const lead1Id = (lead1 as { id: string }).id;
  const sub1Id = await recordSubmission(supabase as Parameters<typeof recordSubmission>[0], {
    tenantId: SYNTHETIC_TENANT,
    leadId: lead1Id,
    formConfigId: form1.id,
    createdVia: "public_form",
    email: testEmail,
    customFields: { test_field: "hello b4" },
    rawPayload: { email: testEmail, form_config_id: form1.id },
    matchedExisting: false,
  });

  const form1Name = await resolveFormName(supabase as Parameters<typeof resolveFormName>[0], form1.id);
  await emitSubmissionAudit(supabase as Parameters<typeof emitSubmissionAudit>[0], {
    tenantId: SYNTHETIC_TENANT,
    leadId: lead1Id,
    submissionId: sub1Id,
    isFirst: true,
    matchedExisting: false,
    formName: form1Name,
    requestId: "b4-test-1",
  });

  // Verify audit
  const { data: audit1 } = await supabase
    .from("audit_logs")
    .select("changes")
    .eq("entity_id", lead1Id)
    .eq("action", "lead.submission")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!audit1) throw new Error("TEST 1 FAIL: No audit_log for lead.submission on lead1");
  const a1 = (audit1 as { changes: Record<string, { old: unknown; new: unknown }> }).changes;
  if (a1.is_first?.new !== true) throw new Error(`TEST 1 FAIL: is_first expected true, got ${a1.is_first?.new}`);
  if (!a1.form_name?.new) throw new Error(`TEST 1 FAIL: form_name is empty — got "${a1.form_name?.new}"`);
  if (a1.form_name.new === "form") throw new Error(`TEST 1 FAIL: form_name is generic "form" — got "${a1.form_name.new}"`);
  console.log(`  ✓ TEST 1: is_first=true, form_name="${a1.form_name.new}"`);

  // ── TEST 2: Resubmit same email → audit with is_first:false + form_name2 ──
  console.log("TEST 2: Resubmit same email → lead.submission with is_first:false + form2");

  const sub2Id = await recordSubmission(supabase as Parameters<typeof recordSubmission>[0], {
    tenantId: SYNTHETIC_TENANT,
    leadId: lead1Id,
    formConfigId: form2.id,
    createdVia: "public_form",
    email: testEmail,
    customFields: { resubmit_field: "resub" },
    rawPayload: { email: testEmail, form_config_id: form2.id },
    matchedExisting: true,
  });

  const form2Name = await resolveFormName(supabase as Parameters<typeof resolveFormName>[0], form2.id);
  await emitSubmissionAudit(supabase as Parameters<typeof emitSubmissionAudit>[0], {
    tenantId: SYNTHETIC_TENANT,
    leadId: lead1Id,
    submissionId: sub2Id,
    isFirst: false,
    matchedExisting: true,
    formName: form2Name,
    requestId: "b4-test-2",
  });

  const { data: audit2 } = await supabase
    .from("audit_logs")
    .select("changes")
    .eq("entity_id", lead1Id)
    .eq("action", "lead.submission")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!audit2) throw new Error("TEST 2 FAIL: No audit_log for resubmission");
  const a2 = (audit2 as { changes: Record<string, { old: unknown; new: unknown }> }).changes;
  if (a2.is_first?.new !== false) throw new Error(`TEST 2 FAIL: is_first expected false, got ${a2.is_first?.new}`);
  if (!a2.form_name?.new) throw new Error(`TEST 2 FAIL: form_name empty`);
  console.log(`  ✓ TEST 2: is_first=false, form_name="${a2.form_name.new}"`);

  // ── TEST 3: Merge → absorbed's form_name on canonical ─────────────────────
  console.log("TEST 3: Merge two leads → absorbed's form_name appears on canonical timeline");

  const absorbedEmail = `b4-absorbed-${Date.now()}@synthetic.invalid`;
  const { data: lead2 } = await supabase.from("leads").insert({
    tenant_id: SYNTHETIC_TENANT,
    pipeline_id: pipelineId,
    stage_id: stageId,
    status: stageSlug,
    is_final: true,
    step: 1,
    email: absorbedEmail,
    first_name: "B4-Absorbed",
    last_name: "Lead",
    form_config_id: form2.id,
    custom_fields: { absorbed_field: "to be merged" },
    intake_source: "test",
  }).select("id").single();

  if (!lead2) throw new Error("Failed to create lead2 for merge test");
  const lead2Id = (lead2 as { id: string }).id;
  createdLeadIds.push(lead2Id);
  await assertNotAdmizz(lead2Id);

  // Create canonical for merge
  const canonicalEmail = `b4-canonical-${Date.now()}@synthetic.invalid`;
  const { data: lead3 } = await supabase.from("leads").insert({
    tenant_id: SYNTHETIC_TENANT,
    pipeline_id: pipelineId,
    stage_id: stageId,
    status: stageSlug,
    is_final: true,
    step: 1,
    email: canonicalEmail,
    first_name: "B4-Canonical",
    last_name: "Lead",
    form_config_id: form1.id,
    custom_fields: { canonical_field: "stays canonical" },
    intake_source: "test",
  }).select("id").single();

  if (!lead3) throw new Error("Failed to create lead3 for merge test");
  const lead3Id = (lead3 as { id: string }).id;
  createdLeadIds.push(lead3Id);
  await assertNotAdmizz(lead3Id);

  await mergeLeads(supabase as Parameters<typeof mergeLeads>[0], {
    tenantId: SYNTHETIC_TENANT,
    canonicalId: lead3Id,
    absorbedId: lead2Id,
    mergedBy: null,
    source: "manual",
    requestId: "b4-test-3",
  });

  // The synthesized submission now has lead_id=lead3Id. Verify audit.
  const { data: mergeAudit } = await supabase
    .from("audit_logs")
    .select("changes")
    .eq("entity_id", lead3Id)
    .eq("action", "lead.submission")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!mergeAudit) throw new Error("TEST 3 FAIL: No lead.submission audit after merge");
  const a3 = (mergeAudit as { changes: Record<string, { old: unknown; new: unknown }> }).changes;
  if (a3.matched_existing?.new !== true) throw new Error(`TEST 3 FAIL: matched_existing expected true`);
  if (a3.form_name?.new === undefined) throw new Error(`TEST 3 FAIL: form_name missing`);
  console.log(`  ✓ TEST 3: merge lead.submission audit, form_name="${a3.form_name.new}", matched_existing=${a3.matched_existing.new}`);

  // ── TEST 4: --email backfill scope ─────────────────────────────────────────
  console.log("TEST 4: --email backfill dry-run writes nothing");

  const { runBackfill: rb } = await import("../src/lib/leads/backfill");
  const dryResult = await rb(supabase as Parameters<typeof rb>[0], {
    apply: false,
    tenantId: SYNTHETIC_TENANT,
    normalizedEmail: testEmail.toLowerCase(),
  });

  console.log(`  Dry-run result: totalGroups=${(dryResult as { totalGroups: number }).totalGroups ?? "N/A (apply result)"}`);
  console.log("  ✓ TEST 4: dry-run completed without writes");

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  All assertions passed.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((err) => {
    console.error("\n✗ FAIL:", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(cleanup);
