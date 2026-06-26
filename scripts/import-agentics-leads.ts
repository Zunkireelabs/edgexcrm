/**
 * Import Agentics leads (2,486 distinct rows — file 9.1, 26 exact-dup rows removed at source) into Admizz migration-qc staging list.
 *
 * Usage:
 *   npx tsx scripts/import-agentics-leads.ts --dry-run   # Preview: parse, count, show 3 samples. No insert.
 *   npx tsx scripts/import-agentics-leads.ts             # Live import to STAGE only.
 *   npx tsx scripts/import-agentics-leads.ts --force     # Delete existing batch rows first, then re-import.
 *
 * Idempotency: guarded by custom_fields.import_batch = "agentics-2026-06-24".
 * A re-run without --force aborts if that batch already exists.
 *
 * STAGE DB ONLY. Never run against prod (pirhnklvtjjpuvbvibxf).
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

config({ path: ".env.local" });

// --- Config ---
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const BATCH_SIZE = 500;

const ADMIZZ_TENANT_ID = "febeb37c-521c-4f29-adbb-0195b2eede88";
const MIGRATION_QC_SLUG = "migration-qc";
const IMPORT_BATCH = "agentics-2026-06-24";
const INTAKE_SOURCE = "Agentics leads";
const XLSX_FILE = "temp_ss/cus-admizz-docs/migration-leads/9.1 - Agentics Lead.xlsx";
const SHEET_NAME = "Agentics-Leads";

// Admizz default pipeline + first stage (matches existing migration-qc leads)
const ADMIZZ_PIPELINE_ID = "bc89ea61-7cd8-4f1d-b542-2d956e546aad";
const ADMIZZ_STAGE_ID = "05b4c1aa-1459-42fa-b1cf-cff76022dc08";

// Exact column headers as they appear in the xlsx (including trailing whitespace/punctuation).
const COL = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  city: "City",
  nationality: "Nationality",
  interested_country: "Interested Country",
  program_category: "Preferred Program Category",
  program_level: "Preferred Program Level",
  source_category: "Source Category:",
  source_channel: "Source Channel:",
  source_page: "Source page/ account / name:",
  campaign: "Campaign / sub-detail:",
} as const;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// --- Interfaces ---
interface CRMLead {
  tenant_id: string;
  list_id: string;
  pipeline_id: string;
  stage_id: string;
  lead_type: string;
  status: string;
  intake_source: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// --- Helpers ---
const ZW_RE = /[​‌﻿]/g;

function clean(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).replace(ZW_RE, "").trim();
  return s === "" || s === "-" ? null : s;
}

function cleanEmail(val: unknown): string | null {
  const s = clean(val);
  return s ? s.toLowerCase() : null;
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const idx = full.indexOf(" ");
  if (idx === -1) return { first: full, last: null };
  return { first: full.slice(0, idx), last: full.slice(idx + 1).trim() || null };
}

// --- Parse xlsx ---
function parseXlsx(): Record<string, unknown>[] {
  const wb = XLSX.readFile(XLSX_FILE);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `Sheet '${SHEET_NAME}' not found. Available: ${wb.SheetNames.join(", ")}`
    );
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
}

// --- Transform ---
function transformRow(
  row: Record<string, unknown>,
  listId: string,
  now: string
): CRMLead {
  const rawName = clean(row[COL.name]);
  const { first, last } = splitName(rawName);
  const rawPhone = clean(row[COL.phone]);
  const email = cleanEmail(row[COL.email]);
  const city = clean(row[COL.city]);

  const custom_fields: Record<string, unknown> = {
    import_batch: IMPORT_BATCH,
  };

  const nationality = clean(row[COL.nationality]);
  if (nationality) custom_fields.nationality = nationality;

  const interested_country = clean(row[COL.interested_country]);
  if (interested_country) custom_fields.interested_country = interested_country;

  const program_category = clean(row[COL.program_category]);
  if (program_category) custom_fields.program_category = program_category;

  const program_level = clean(row[COL.program_level]);
  if (program_level) custom_fields.program_level = program_level;

  const source_category = clean(row[COL.source_category]);
  if (source_category) custom_fields.source_category = source_category;

  const source_channel = clean(row[COL.source_channel]);
  if (source_channel) custom_fields.source_channel = source_channel;

  const source_page = clean(row[COL.source_page]);
  if (source_page) custom_fields.source_page = source_page;

  const campaign = clean(row[COL.campaign]);
  if (campaign) custom_fields.campaign = campaign;

  if (rawPhone) custom_fields.raw_phone = rawPhone;

  return {
    tenant_id: ADMIZZ_TENANT_ID,
    list_id: listId,
    pipeline_id: ADMIZZ_PIPELINE_ID,
    stage_id: ADMIZZ_STAGE_ID,
    lead_type: "lead",
    status: "new",
    intake_source: INTAKE_SOURCE,
    first_name: first,
    last_name: last,
    email,
    phone: rawPhone,
    city,
    custom_fields,
    created_at: now,
    updated_at: now,
  };
}

// --- Main ---
async function main() {
  console.log("=".repeat(60));
  console.log("AGENTICS LEADS IMPORT — ADMIZZ MIGRATION-QC");
  console.log("=".repeat(60));
  console.log(`Mode:         ${DRY_RUN ? "DRY RUN (no data will be inserted)" : FORCE ? "LIVE + FORCE (existing batch deleted first)" : "LIVE IMPORT"}`);
  console.log(`Target DB:    ${SUPABASE_URL}`);
  console.log(`Tenant:       Admizz (${ADMIZZ_TENANT_ID})`);
  console.log(`Import batch: ${IMPORT_BATCH}`);
  console.log("");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  // Abort if accidentally pointed at prod
  if (SUPABASE_URL.includes("pirhnklvtjjpuvbvibxf")) {
    console.error("ERROR: .env.local points at PRODUCTION DB. Aborting. Stage DB only.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Resolve migration-qc list ID
  const { data: list, error: listErr } = await supabase
    .from("lead_lists")
    .select("id, name, slug")
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("slug", MIGRATION_QC_SLUG)
    .eq("is_staging", true)
    .single();

  if (listErr || !list) {
    console.error(`ERROR: Could not resolve migration-qc list:`, listErr?.message);
    process.exit(1);
  }
  console.log(`Resolved list: ${list.name} (${list.id})`);

  // 2. Before count
  const { count: beforeCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("list_id", list.id)
    .is("deleted_at", null);

  console.log(`migration-qc BEFORE count: ${beforeCount}`);

  // 3. Idempotency check
  const { count: existingBatchCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("custom_fields->>import_batch" as string, IMPORT_BATCH)
    .is("deleted_at", null);

  if ((existingBatchCount ?? 0) > 0) {
    if (!FORCE) {
      console.error(
        `\nABORT: Found ${existingBatchCount} rows already marked import_batch="${IMPORT_BATCH}".`
      );
      console.error(`Re-run with --force to delete existing rows and re-import.`);
      process.exit(1);
    }
    if (!DRY_RUN) {
      console.log(`\n--force: deleting ${existingBatchCount} existing rows with import_batch="${IMPORT_BATCH}"...`);
      const { error: delErr } = await supabase
        .from("leads")
        .delete()
        .eq("tenant_id", ADMIZZ_TENANT_ID)
        .eq("custom_fields->>import_batch" as string, IMPORT_BATCH);
      if (delErr) {
        console.error("ERROR: Failed to delete existing rows:", delErr.message);
        process.exit(1);
      }
      console.log("Existing batch rows deleted.");
    }
  }

  // 4. Parse xlsx
  console.log(`\nParsing ${XLSX_FILE} (sheet: ${SHEET_NAME})...`);
  let rows: Record<string, unknown>[];
  try {
    rows = parseXlsx();
  } catch (e) {
    console.error("ERROR parsing xlsx:", e);
    process.exit(1);
  }
  console.log(`Parsed ${rows.length} rows from xlsx.`);

  const now = new Date().toISOString();
  const leads = rows.map((row) => transformRow(row, list.id, now));

  // Data quality stats
  const withEmail = leads.filter((l) => l.email).length;
  const withPhone = leads.filter((l) => l.phone).length;
  const withBoth = leads.filter((l) => l.email && l.phone).length;
  const withNeither = leads.filter((l) => !l.email && !l.phone).length;
  const withName = leads.filter((l) => l.first_name).length;

  console.log(`\nData quality:`);
  console.log(`  Total rows:      ${leads.length}`);
  console.log(`  With name:       ${withName}`);
  console.log(`  With email:      ${withEmail}`);
  console.log(`  With phone:      ${withPhone}`);
  console.log(`  With both:       ${withBoth}`);
  console.log(`  With neither:    ${withNeither} (name-only rows)`);

  if (DRY_RUN) {
    console.log("\n--- Sample mapped rows (first 3) ---");
    for (const lead of leads.slice(0, 3)) {
      console.log(JSON.stringify(lead, null, 2));
    }
    console.log("\n✓ Dry run complete. No data was inserted.");
    return;
  }

  // 5. Batch insert
  console.log(`\nInserting ${leads.length} leads in batches of ${BATCH_SIZE}...`);
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const { data, error: insertErr } = await supabase
      .from("leads")
      .insert(batch)
      .select("id");

    if (insertErr) {
      console.error(
        `\nBatch ${Math.floor(i / BATCH_SIZE) + 1} error:`,
        insertErr.message
      );
      failed += batch.length;
    } else {
      inserted += (data || []).length;
    }
    process.stdout.write(`\rProgress: ${Math.min(i + BATCH_SIZE, leads.length)}/${leads.length}  `);
  }

  console.log(`\n`);

  // 6. After count
  const { count: afterCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("list_id", list.id)
    .is("deleted_at", null);

  const { count: batchCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("custom_fields->>import_batch" as string, IMPORT_BATCH)
    .is("deleted_at", null);

  console.log("=".repeat(60));
  console.log("IMPORT COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Inserted:              ${inserted}`);
  console.log(`  Failed:                ${failed}`);
  console.log(`  migration-qc BEFORE:   ${beforeCount}`);
  console.log(`  migration-qc AFTER:    ${afterCount}`);
  console.log(`  Batch marker count:    ${batchCount} (import_batch="${IMPORT_BATCH}")`);

  if (failed > 0) {
    console.error(`\nWARNING: ${failed} rows failed to insert.`);
    process.exit(1);
  }

  // 7. Spot-check: print 3 loaded rows
  const { data: spotCheck } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, phone, city, intake_source, list_id, custom_fields")
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .eq("custom_fields->>import_batch" as string, IMPORT_BATCH)
    .is("deleted_at", null)
    .limit(3);

  console.log("\n--- Spot-check: 3 loaded rows ---");
  for (const row of spotCheck || []) {
    console.log(JSON.stringify(row, null, 2));
  }

  console.log("\n✓ Done. STOP — do not push/PR/merge. Opus reviews on stage.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
