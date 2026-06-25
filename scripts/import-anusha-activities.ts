/**
 * Import Anusha (admizzintern2) interaction history onto existing Admizz staging leads.
 * Attaches activities from both sheets (Direct Leads + Sub Prospects), assigns unassigned
 * leads to Anusha, and inserts audit_logs for each newly assigned lead.
 *
 * Stage DB only. Idempotent on batch tag.
 *
 * Usage:
 *   npx tsx scripts/import-anusha-activities.ts --dry-run
 *   npx tsx scripts/import-anusha-activities.ts
 *   npx tsx scripts/import-anusha-activities.ts --force
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";

config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const BATCH_SIZE = 200;

const ADMIZZ_TENANT_ID = "febeb37c-521c-4f29-adbb-0195b2eede88";
const ANUSHA_USER_ID = "9724c923-867b-41a1-a882-3823e927bda8"; // admizzintern2@gmail.com
const ADMIN_USER_ID = "bfff9897-3ab4-4e94-90d8-e0517528edf6"; // admizzdotcom2020@gmail.com (actor for audit_logs)
const IMPORT_BATCH = "admizz-activities-anusha-2026-06-25";
const SOURCE_FILE = "temp_ss/cus-admizz-docs/leads-interaction-and-activites/Anusha Intern.xlsx";

// Counselors whose assignments must not be touched — used only for before/after verification
const PROTECTED_OWNERS: Record<string, string> = {
  Purnima: "ad32e374-b421-45f2-a32a-b0ef003e4dba",
  "Diplov Karn": "2c17f521-5f05-4419-8b85-803357787602",
  Kamana: "e6e2ad98-2838-4202-a67e-da71ae68227d",
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ---

const ZW_RE = /[​‌﻿]/g;

function clean(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).replace(ZW_RE, "").trim();
  return s === "" || s === "-" || s === "N/A" || s === "n/a" ? null : s;
}

function phone10(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  const p = digits.slice(-10);
  if (/^(.)\1+$/.test(p)) return null;
  if (["1234567890", "9876543210", "0000000000"].includes(p)) return null;
  return p;
}

interface Activity {
  tenant_id: string;
  lead_id: string;
  user_id: string;
  activity_type: "call" | "email" | "meeting";
  subject: string;
  description: string;
  completed_at: string;
  metadata: Record<string, unknown>;
}

async function main() {
  console.log("=".repeat(60));
  console.log("ANUSHA INTERN ACTIVITIES IMPORT");
  console.log("=".repeat(60));
  console.log(`Mode:         ${DRY_RUN ? "DRY RUN (no writes)" : FORCE ? "LIVE + FORCE (delete+re-import)" : "LIVE IMPORT"}`);
  console.log(`Target DB:    ${SUPABASE_URL}`);
  console.log(`Batch:        ${IMPORT_BATCH}`);
  console.log(`Anusha UUID:  ${ANUSHA_USER_ID}`);
  console.log("");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  if (SUPABASE_URL.includes("pirhnklvtjjpuvbvibxf")) {
    console.error("ERROR: .env.local points at PRODUCTION DB. Aborting. Stage DB only.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Idempotency check — batch-level guard, same as import-admizz-activities.ts
  const { count: existingBatchCount } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .contains("metadata", { batch: IMPORT_BATCH });

  if ((existingBatchCount ?? 0) > 0) {
    if (!FORCE) {
      console.error(`\nABORT: Found ${existingBatchCount} activities with batch="${IMPORT_BATCH}".`);
      console.error("Re-run is a no-op. Use --force to delete existing and re-import.");
      process.exit(1);
    }
    if (!DRY_RUN) {
      console.log(`--force: deleting ${existingBatchCount} existing activities with batch="${IMPORT_BATCH}"...`);
      let deleted = 0;
      while (true) {
        const { data: toDelete } = await supabase
          .from("lead_activities")
          .select("id")
          .eq("tenant_id", ADMIZZ_TENANT_ID)
          .contains("metadata", { batch: IMPORT_BATCH })
          .limit(500);
        if (!toDelete || toDelete.length === 0) break;
        await supabase.from("lead_activities").delete().in("id", toDelete.map((r) => r.id));
        deleted += toDelete.length;
        process.stdout.write(`\r  Deleted ${deleted}...`);
      }
      console.log(`\n  Deleted ${deleted} activities.`);
    }
  }

  // 2. Build phone10 → [lead_id] lookup map for Admizz staging leads
  console.log("\nBuilding phone lookup map...");
  const allLeads: { id: string; phone: string | null; assigned_to: string | null }[] = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, phone, assigned_to")
      .eq("tenant_id", ADMIZZ_TENANT_ID)
      .is("deleted_at", null)
      .range(from, from + CHUNK - 1);
    if (error) {
      console.error("ERROR fetching leads:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < CHUNK) break;
  }
  console.log(`  Loaded ${allLeads.length} leads.`);

  const phone10ToLeadIds = new Map<string, string[]>();
  const leadById = new Map<string, { id: string; phone: string | null; assigned_to: string | null }>();
  for (const lead of allLeads) {
    leadById.set(lead.id, lead);
    const p10 = phone10(lead.phone);
    if (p10) {
      const list = phone10ToLeadIds.get(p10) ?? [];
      list.push(lead.id);
      phone10ToLeadIds.set(p10, list);
    }
  }
  console.log(`  Phone10 entries: ${phone10ToLeadIds.size}`);

  // 3. Before counts — protected owners (for verification report)
  const beforeProtected: Record<string, number> = {};
  for (const [name, userId] of Object.entries(PROTECTED_OWNERS)) {
    const { count } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", ADMIZZ_TENANT_ID)
      .eq("assigned_to", userId)
      .is("deleted_at", null);
    beforeProtected[name] = count ?? 0;
  }
  console.log("\nProtected owner lead counts (BEFORE):");
  for (const [name, count] of Object.entries(beforeProtected)) {
    console.log(`  ${name}: ${count}`);
  }

  // 4. Parse xlsx — one pass per sheet, build activities + matched phone set
  console.log(`\nParsing ${SOURCE_FILE}...`);
  const wb = XLSX.readFile(SOURCE_FILE);
  const completedAt = new Date().toISOString();

  const activities: Activity[] = [];
  const matchedPhones = new Set<string>();
  const unmatchedRows: Array<{ sheet: string; phone: string | null; row: number }> = [];

  // Track sheets and their row counts for the dual-sheet example
  const sheetPhones: Map<string, Set<string>> = new Map();

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    console.log(`\n  Sheet: ${JSON.stringify(sheetName)} — ${rows.length} rows`);

    const phonesThisSheet = new Set<string>();
    sheetPhones.set(sheetName, phonesThisSheet);

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const p10 = phone10(row["Phone"]);
      if (!p10) {
        unmatchedRows.push({ sheet: sheetName, phone: null, row: rowIdx + 2 });
        continue;
      }

      const leadIds = phone10ToLeadIds.get(p10);
      if (!leadIds || leadIds.length === 0) {
        unmatchedRows.push({ sheet: sheetName, phone: p10, row: rowIdx + 2 });
        console.log(`  [UNMATCHED] sheet=${sheetName} row=${rowIdx + 2} phone=${p10}`);
        continue;
      }

      matchedPhones.add(p10);
      phonesThisSheet.add(p10);

      // Build description: base Remarks + labelled follow-up columns
      const baseRemark = clean(row["Remarks "]);
      const followUps: string[] = [];
      for (const key of ["__EMPTY", "__EMPTY_1", "__EMPTY_2", "__EMPTY_3"]) {
        const val = clean(row[key]);
        if (val) followUps.push(`Follow-up: ${val}`);
      }
      const descParts = [baseRemark, ...followUps].filter(Boolean) as string[];
      const description = descParts.join("\n\n").trim();
      if (!description) continue;

      const metadata: Record<string, unknown> = {
        batch: IMPORT_BATCH,
        match_key: `phone10:${p10}`,
        source_file: "Anusha Intern.xlsx",
        source_sheet: sheetName,
      };

      // Fan-out: one activity per matched staging lead (handles raw-staging duplicates)
      for (const leadId of leadIds) {
        activities.push({
          tenant_id: ADMIZZ_TENANT_ID,
          lead_id: leadId,
          user_id: ANUSHA_USER_ID,
          activity_type: "call",
          subject: "Tele-call remark",
          description,
          completed_at: completedAt,
          metadata,
        });
      }
    }

    console.log(`    Matched ${phonesThisSheet.size} phones → ${activities.length} activities total so far`);
  }

  // 5. Identify leads to assign (unassigned among all matched leads — deduplicated)
  const leadsToAssign: string[] = [];
  for (const p10 of matchedPhones) {
    const ids = phone10ToLeadIds.get(p10) ?? [];
    for (const id of ids) {
      const lead = leadById.get(id);
      if (lead && lead.assigned_to === null) {
        leadsToAssign.push(id);
      }
    }
  }
  // Deduplicate (a lead could match multiple phones if data has aliases — rare but safe)
  const uniqueLeadsToAssign = [...new Set(leadsToAssign)];

  // 6. Dual-sheet example: phones that appear in both sheets
  const directPhones = sheetPhones.get("Direct Leads ") ?? new Set<string>();
  const subPhones = sheetPhones.get("Sub Prospects ") ?? new Set<string>();
  const dualPhonesList = [...subPhones].filter((p) => directPhones.has(p));

  console.log("\n" + "=".repeat(60));
  console.log("PRE-RUN SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Source rows (Direct Leads):   ${(sheetPhones.get("Direct Leads ") ?? new Set()).size} matched phones`);
  console.log(`  Source rows (Sub Prospects):  ${(sheetPhones.get("Sub Prospects ") ?? new Set()).size} matched phones`);
  console.log(`  Dual-sheet phones (both):     ${dualPhonesList.length} (each gets 2 activities)`);
  console.log(`  Total matched phones:         ${matchedPhones.size}`);
  console.log(`  Activities to insert:         ${activities.length}`);
  console.log(`  Unmatched rows:               ${unmatchedRows.length}`);
  console.log(`  Leads to assign (IS NULL):    ${uniqueLeadsToAssign.length}`);

  if (unmatchedRows.length > 0) {
    console.log(`\n  Unmatched rows (phone10 not found in staging leads):`);
    for (const u of unmatchedRows) {
      console.log(`    sheet=${u.sheet} row=${u.row} phone=${u.phone ?? "(null)"}`);
    }
  }

  // Dual-sheet spot-check (pre-run)
  if (dualPhonesList.length > 0) {
    const exP10 = dualPhonesList[0];
    const exLeadIds = phone10ToLeadIds.get(exP10) ?? [];
    const exActs = activities.filter((a) => a.metadata.match_key === `phone10:${exP10}`);
    console.log(`\n  Dual-sheet example — phone ${exP10} → ${exLeadIds.length} lead(s), ${exActs.length} activities:`);
    for (const a of exActs) {
      console.log(`    Sheet: ${a.metadata.source_sheet}`);
      console.log(`    Desc:  ${a.description.slice(0, 120)}`);
    }
  }

  if (DRY_RUN) {
    console.log("\n✓ Dry run complete. No data was written.");
    return;
  }

  // 7. Before count
  const { count: actBefore } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID);

  // 8. Insert activities in batches
  console.log(`\nInserting ${activities.length} activities in batches of ${BATCH_SIZE}...`);
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < activities.length; i += BATCH_SIZE) {
    const batch = activities.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.from("lead_activities").insert(batch).select("id");
    if (error) {
      console.error(`\nBatch error at offset ${i}:`, error.message);
      failed += batch.length;
    } else {
      inserted += (data ?? []).length;
    }
    process.stdout.write(`\rProgress: ${Math.min(i + BATCH_SIZE, activities.length)}/${activities.length}  `);
  }
  console.log("");

  // 9. Assign unassigned leads + insert audit_logs for each
  console.log(`\nAssigning ${uniqueLeadsToAssign.length} leads to Anusha + writing audit_logs...`);
  let assignUpdated = 0;
  let auditInserted = 0;
  let assignFailed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < uniqueLeadsToAssign.length; i += BATCH_SIZE) {
    const chunk = uniqueLeadsToAssign.slice(i, i + BATCH_SIZE);

    // Update leads — double-guard with IS NULL to be safe against race
    const { error: updateErr } = await supabase
      .from("leads")
      .update({ assigned_to: ANUSHA_USER_ID })
      .in("id", chunk)
      .eq("tenant_id", ADMIZZ_TENANT_ID)
      .is("assigned_to", null);

    if (updateErr) {
      console.error(`\nAssign batch error at offset ${i}:`, updateErr.message);
      assignFailed += chunk.length;
      continue;
    }
    assignUpdated += chunk.length;

    // Insert audit_logs for each newly assigned lead (mirrors mig 082 shape)
    const auditRows = chunk.map((leadId) => ({
      id: randomUUID(),
      tenant_id: ADMIZZ_TENANT_ID,
      user_id: ADMIN_USER_ID,
      action: "lead.updated",
      entity_type: "lead",
      entity_id: leadId,
      changes: { assigned_to: { old: null, new: ANUSHA_USER_ID } },
      created_at: now,
    }));

    const { data: auditData, error: auditErr } = await supabase
      .from("audit_logs")
      .insert(auditRows)
      .select("id");

    if (auditErr) {
      console.error(`\nAudit log insert error at offset ${i}:`, auditErr.message);
    } else {
      auditInserted += (auditData ?? []).length;
    }

    process.stdout.write(`\rAssign progress: ${Math.min(i + BATCH_SIZE, uniqueLeadsToAssign.length)}/${uniqueLeadsToAssign.length}  `);
  }
  console.log("");

  // 10. After counts
  const { count: actAfter } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID);

  const { count: batchCount } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .contains("metadata", { batch: IMPORT_BATCH });

  const { count: anushaAssigned } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("assigned_to", ANUSHA_USER_ID)
    .is("deleted_at", null);

  // Verify protected owners unchanged
  console.log("\nProtected owner lead counts (AFTER):");
  for (const [name, userId] of Object.entries(PROTECTED_OWNERS)) {
    const { count } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", ADMIZZ_TENANT_ID)
      .eq("assigned_to", userId)
      .is("deleted_at", null);
    const after = count ?? 0;
    const before = beforeProtected[name];
    const status = after === before ? "✓ unchanged" : `⚠ CHANGED (was ${before}, now ${after})`;
    console.log(`  ${name}: ${after} ${status}`);
  }

  // Dual-sheet DB spot-check
  if (dualPhonesList.length > 0) {
    const exP10 = dualPhonesList[0];
    const exLeadIds = phone10ToLeadIds.get(exP10) ?? [];
    if (exLeadIds.length > 0) {
      const { data: dualCheck } = await supabase
        .from("lead_activities")
        .select("id, subject, description, metadata")
        .eq("lead_id", exLeadIds[0])
        .contains("metadata", { batch: IMPORT_BATCH })
        .order("completed_at");
      console.log(`\n--- Dual-sheet DB spot-check (phone ${exP10}, lead ${exLeadIds[0]}) ---`);
      for (const a of dualCheck ?? []) {
        const meta = a.metadata as Record<string, unknown>;
        console.log(`  Sheet: ${meta.source_sheet}`);
        console.log(`  Desc:  ${a.description.slice(0, 140)}`);
      }
    }
  }

  // Sample activities spot-check
  const { data: spotCheck } = await supabase
    .from("lead_activities")
    .select("id, lead_id, subject, description, user_id, metadata")
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .contains("metadata", { batch: IMPORT_BATCH })
    .limit(3);
  console.log("\n--- Sample inserted activities (first 3) ---");
  for (const row of spotCheck ?? []) {
    console.log(JSON.stringify({ ...row, description: row.description?.slice(0, 80) + "…" }, null, 2));
  }

  // Final report
  console.log("\n" + "=".repeat(60));
  console.log("IMPORT COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Activities inserted:        ${inserted}`);
  console.log(`  Activities failed:          ${failed}`);
  console.log(`  lead_activities BEFORE:    ${actBefore}`);
  console.log(`  lead_activities AFTER:     ${actAfter}`);
  console.log(`  Batch marker count:        ${batchCount} (batch="${IMPORT_BATCH}")`);
  console.log(`  Leads assigned to Anusha:  ${assignUpdated}`);
  console.log(`  Anusha total (all time):   ${anushaAssigned}`);
  console.log(`  Audit logs inserted:       ${auditInserted}`);
  console.log(`  Assign errors:             ${assignFailed}`);
  console.log(`  Matched phones:            ${matchedPhones.size}`);
  console.log(`  Unmatched rows:            ${unmatchedRows.length}`);
  console.log(`  Dual-sheet phones:         ${dualPhonesList.length}`);

  if (failed > 0 || assignFailed > 0) {
    console.error(`\nWARNING: ${failed} activity inserts / ${assignFailed} assignment batches failed.`);
    process.exit(1);
  }

  console.log("\n✓ Done. STOP — do not push/PR/merge. Opus reviews on stage.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
