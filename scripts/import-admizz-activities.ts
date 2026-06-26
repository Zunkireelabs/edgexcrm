/**
 * Import Admizz staff interaction history onto existing staging leads.
 * Attaches activities, assignment, and pending-application flags from 10 staff workbooks.
 * Enrichment only — does NOT change list_id, does NOT create Application records,
 * does NOT promote to main.
 *
 * Usage:
 *   npx tsx scripts/import-admizz-activities.ts --dry-run
 *   npx tsx scripts/import-admizz-activities.ts --force
 *   npx tsx scripts/import-admizz-activities.ts
 *
 * STAGE DB ONLY. Aborts if NEXT_PUBLIC_SUPABASE_URL contains pirhnklvtjjpuvbvibxf (prod).
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

config({ path: ".env.local" });

// --- Config ---
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const BATCH_SIZE = 200;

const ADMIZZ_TENANT_ID = "febeb37c-521c-4f29-adbb-0195b2eede88";
const IMPORT_BATCH = "admizz-activities-2026-06-25";
const WORKBOOK_DIR = "temp_ss/cus-admizz-docs/leads-interaction-and-activites";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// -----------------------------------------------------------------------
// Staff → user_id map (resolved from stage DB)
// -----------------------------------------------------------------------
const ADMIN_USER_ID = "bfff9897-3ab4-4e94-90d8-e0517528edf6"; // admizzdotcom2020@gmail.com — fallback

const STAFF_BY_EMAIL: Record<string, string> = {
  "amit.rawal@admizz.org": "3168f9d7-23c7-48c1-a29b-3b9a94b3512f",
  "gautam.ray@admizz.org": "a61ed605-a9cd-44aa-89f7-a2f4909192b7",
  "nikhil.mirdha@admizz.org": "583705ad-b166-47a6-8271-61cb76947850",
  "diplov.karn@admizz.org": "2c17f521-5f05-4419-8b85-803357787602",
  "dikshyaadmizz@gmail.com": "44d755af-d1dc-48dc-9143-d2704c5859c0",
  "samriti.admizz@gmail.com": "862fb2ec-73fc-4310-810a-9d710d513982",
  "kamana.admizz@gmail.com": "e6e2ad98-2838-4202-a67e-da71ae68227d",
  "purnima.admizz@gmail.com": "ad32e374-b421-45f2-a32a-b0ef003e4dba",
  "admizzintern3@gmail.com": "1f26290e-c19a-4e64-91b8-dc3fc7a9cfb2", // Ashmita/Asmita
  "admizzintern4@gmail.com": "2b568f0b-2346-4a9a-978b-ddad6c4346cb", // Reya/Riya
  "admizzintern1@gmail.com": "303f424b-7daf-43ba-92ea-e09a9b1ec878", // Simrika
};

// Normalize display names (as they appear in xlsx) → user_id
// Strips honorifics ("Sir", "Ma'am") and normalises spelling variants
function resolveStaffName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/\s+(sir|ma'?am|madam)\s*$/i, "")
    .trim()
    .toLowerCase();

  const MAP: Record<string, string> = {
    "amit": STAFF_BY_EMAIL["amit.rawal@admizz.org"],
    "amit rawal": STAFF_BY_EMAIL["amit.rawal@admizz.org"],
    "gautam": STAFF_BY_EMAIL["gautam.ray@admizz.org"],
    "gautam ray": STAFF_BY_EMAIL["gautam.ray@admizz.org"],
    "nikhil": STAFF_BY_EMAIL["nikhil.mirdha@admizz.org"],
    "nikhil mirdha": STAFF_BY_EMAIL["nikhil.mirdha@admizz.org"],
    "diplov": STAFF_BY_EMAIL["diplov.karn@admizz.org"],
    "diplov karn": STAFF_BY_EMAIL["diplov.karn@admizz.org"],
    "dikshya": STAFF_BY_EMAIL["dikshyaadmizz@gmail.com"],
    "samriti": STAFF_BY_EMAIL["samriti.admizz@gmail.com"],
    "kamana": STAFF_BY_EMAIL["kamana.admizz@gmail.com"],
    "purnima": STAFF_BY_EMAIL["purnima.admizz@gmail.com"],
    "ashmita": STAFF_BY_EMAIL["admizzintern3@gmail.com"],
    "asmita": STAFF_BY_EMAIL["admizzintern3@gmail.com"],
    "reya": STAFF_BY_EMAIL["admizzintern4@gmail.com"],
    "riya": STAFF_BY_EMAIL["admizzintern4@gmail.com"],
    "simrika": STAFF_BY_EMAIL["admizzintern1@gmail.com"],
  };
  return MAP[s] ?? null;
}

// Resolve user_id from sheet name (counselor/application/intern/front-desk contexts)
function sheetNameToUserId(sheetName: string): string | null {
  return resolveStaffName(sheetName.trim());
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
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
  // Filter obvious placeholders
  if (/^(.)\1+$/.test(p)) return null;
  if (["1234567890", "9876543210", "0000000000"].includes(p)) return null;
  return p;
}

// Deduplicate key for activities: lead_id + subject + first 150 chars of description
// Prevents re-inserting the same note when 3 counselor files have identical sheets
const activityDedup = new Set<string>();

function makeDedupeKey(leadId: string, subject: string, desc: string): string {
  return `${leadId}::${subject}::${desc.slice(0, 150)}`;
}

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------
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

interface LeadUpdate {
  lead_id: string;
  assigned_to?: string; // only set if currently null
  custom_fields_patch?: Record<string, unknown>;
  add_tag?: string;
}

// -----------------------------------------------------------------------
// Activity collection
// -----------------------------------------------------------------------
function collectActivity(
  activities: Activity[],
  leadId: string,
  userId: string,
  subject: string,
  description: string,
  completedAt: string,
  metadata: Record<string, unknown>
): void {
  const desc = description.trim();
  if (!desc) return;
  const key = makeDedupeKey(leadId, subject, desc);
  if (activityDedup.has(key)) return;
  activityDedup.add(key);
  activities.push({
    tenant_id: ADMIZZ_TENANT_ID,
    lead_id: leadId,
    user_id: userId,
    activity_type: "call",
    subject,
    description: desc,
    completed_at: completedAt,
    metadata: { import_batch: IMPORT_BATCH, ...metadata },
  });
}

// -----------------------------------------------------------------------
// File processing: Type-A Counselor workbooks
//   Files: Diplov Counsellor.xlsx | Gautam Counsellor.xlsx | Nikhil Counsellor.xlsx
//   Sheets: Amit, Diplov, Gautam, Nikhil
//   Match: CRM ID → legacy_crm_id
// -----------------------------------------------------------------------
function processCounselorWb(
  file: string,
  rows: Record<string, unknown>[],
  sheetName: string,
  crmIdToLeadIds: Map<string, string[]>,
  activities: Activity[],
  leadUpdates: Map<string, LeadUpdate>,
  stats: ProcessStats,
  completedAt: string
): void {
  const sourceFile = path.basename(file);
  for (const row of rows) {
    const crmIdRaw = clean(row["CRM ID"]);
    if (!crmIdRaw) continue;
    const crmId = crmIdRaw.trim().toUpperCase();

    const leadIds = crmIdToLeadIds.get(crmId);
    if (!leadIds || leadIds.length === 0) {
      stats.unmatchedCrmIds.add(crmId);
      continue;
    }
    stats.matchedCrmIds.add(crmId);

    // Resolve counselor
    const assignedToRaw = clean(row["Assigned To"]);
    const counselorUserId = resolveStaffName(assignedToRaw);

    // Counselor for pending_application (display name)
    const counselorDisplayName = assignedToRaw;

    for (const leadId of leadIds) {
      // Front Desk/Tele Caller Notes
      const frontDeskNote = clean(row["Front Desk/Tele Caller Notes"]);
      if (frontDeskNote) {
        collectActivity(activities, leadId, ADMIN_USER_ID, "Front desk note", frontDeskNote, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: "Front Desk/Tele Caller Notes", match_key: `crm_id:${crmId}`,
        });
      }

      // Counselor's Notes
      const counselorNotes = clean(row["Counselor's Notes"]);
      if (counselorNotes) {
        collectActivity(activities, leadId, counselorUserId ?? ADMIN_USER_ID, "Counselor note", counselorNotes, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: "Counselor's Notes", match_key: `crm_id:${crmId}`,
          author: counselorDisplayName,
        });
      }

      // Assignment (only if null)
      if (counselorUserId) {
        const upd = leadUpdates.get(leadId) ?? { lead_id: leadId };
        if (!upd.assigned_to) upd.assigned_to = counselorUserId;
        leadUpdates.set(leadId, upd);
      }

      // Pending application (counselor wbs fields)
      const university = clean(row["Exact University/College to Process"]);
      const course = clean(row["Exact Course/Program to Process"]);
      const processingFee = clean(row["Processing Fee"]);
      const consentSigned = clean(row["Consent Form Signed"]);

      if (university || course || processingFee || consentSigned) {
        const upd = leadUpdates.get(leadId) ?? { lead_id: leadId };
        upd.custom_fields_patch = upd.custom_fields_patch ?? {};
        const pa: Record<string, unknown> = upd.custom_fields_patch.pending_application as Record<string, unknown> ?? {};
        if (university) pa.university = pa.university ?? university;
        if (course) pa.course = pa.course ?? course;
        if (processingFee) pa.processing_fee = pa.processing_fee ?? processingFee;
        if (consentSigned) pa.consent_form_signed = pa.consent_form_signed ?? consentSigned;
        if (counselorDisplayName) pa.counselor = pa.counselor ?? counselorDisplayName;
        upd.custom_fields_patch.pending_application = pa;
        upd.custom_fields_patch.has_pending_application = true;
        upd.add_tag = "pending-application-import";
        leadUpdates.set(leadId, upd);
      }
    }
  }
}

// -----------------------------------------------------------------------
// File processing: Type-A Application workbooks
//   Files: Dikshya Application.xlsx | Samriti Application.xlsx
//   Sheets: Dikshya, Samriti
//   Match: CRM ID → legacy_crm_id
// -----------------------------------------------------------------------
function processApplicationWb(
  file: string,
  rows: Record<string, unknown>[],
  sheetName: string,
  crmIdToLeadIds: Map<string, string[]>,
  activities: Activity[],
  leadUpdates: Map<string, LeadUpdate>,
  stats: ProcessStats,
  completedAt: string
): void {
  const sourceFile = path.basename(file);
  const appExecUserId = sheetNameToUserId(sheetName) ?? ADMIN_USER_ID;

  for (const row of rows) {
    const crmIdRaw = clean(row["CRM ID"]);
    if (!crmIdRaw) continue;
    const crmId = crmIdRaw.trim().toUpperCase();

    const leadIds = crmIdToLeadIds.get(crmId);
    if (!leadIds || leadIds.length === 0) {
      stats.unmatchedCrmIds.add(crmId);
      continue;
    }
    stats.matchedCrmIds.add(crmId);

    // Resolve counselor from "Counselor" column
    const counselorRaw = clean(row["Counselor"]);
    const counselorUserId = resolveStaffName(counselorRaw);
    const appExecRaw = clean(row["Application Executive"]);

    for (const leadId of leadIds) {
      // Front Desk Note
      const frontDeskNote = clean(row["Front Desk Note"]);
      if (frontDeskNote) {
        collectActivity(activities, leadId, ADMIN_USER_ID, "Front desk note", frontDeskNote, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: "Front Desk Note", match_key: `crm_id:${crmId}`,
        });
      }

      // Counselor's Notes
      const counselorNotes = clean(row["Counselor's Notes"]);
      if (counselorNotes) {
        collectActivity(activities, leadId, counselorUserId ?? ADMIN_USER_ID, "Counselor note", counselorNotes, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: "Counselor's Notes", match_key: `crm_id:${crmId}`,
          author: counselorRaw,
        });
      }

      // Application Team Remarks
      const appRemarks = clean(row["Application Team Remarks/Current Update"]);
      if (appRemarks) {
        collectActivity(activities, leadId, appExecUserId, "Application team remark", appRemarks, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: "Application Team Remarks/Current Update", match_key: `crm_id:${crmId}`,
          author: appExecRaw ?? sheetName,
        });
      }

      // Assignment — use counselor if present
      if (counselorUserId) {
        const upd = leadUpdates.get(leadId) ?? { lead_id: leadId };
        if (!upd.assigned_to) upd.assigned_to = counselorUserId;
        leadUpdates.set(leadId, upd);
      }

      // Pending application (richer fields from application wbs)
      const university = clean(row["University/College Interested to Process"]);
      const course = clean(row["Exact Course/Program Mentioned in Offer"]);
      const intake = clean(row["Intake"]);
      const processingFee = clean(row["Processing Fee"]);
      const consentSigned = clean(row["Consent Form Signed"]);
      const deadlines = clean(row["Deadlines"]);
      const daysWithAdmizz = clean(row["Days with Admizz"]);

      const upd = leadUpdates.get(leadId) ?? { lead_id: leadId };
      upd.custom_fields_patch = upd.custom_fields_patch ?? {};
      const pa: Record<string, unknown> = upd.custom_fields_patch.pending_application as Record<string, unknown> ?? {};
      if (university) pa.university = university; // application wbs overrides counselor wbs
      if (course) pa.course = course;
      if (intake) pa.intake = pa.intake ?? intake;
      if (processingFee) pa.processing_fee = processingFee;
      if (consentSigned) pa.consent_form_signed = consentSigned;
      if (deadlines) pa.deadlines = pa.deadlines ?? deadlines;
      if (daysWithAdmizz) pa.days_with_admizz = pa.days_with_admizz ?? daysWithAdmizz;
      if (appExecRaw) pa.application_executive = appExecRaw;
      if (counselorRaw) pa.counselor = counselorRaw;
      upd.custom_fields_patch.pending_application = pa;
      upd.custom_fields_patch.has_pending_application = true;
      upd.add_tag = "pending-application-import";
      leadUpdates.set(leadId, upd);
    }
  }
}

// -----------------------------------------------------------------------
// File processing: Type-B Intern workbooks
//   Files: Ashmita Intern.xlsx | Reya Intern.xlsx | Simrika Intern.xlsx
//   Sheets: Direct Leads, Sub Prospects
//   Match: phone last-10
// -----------------------------------------------------------------------
function processInternWb(
  file: string,
  rows: Record<string, unknown>[],
  sheetName: string,
  phone10ToLeadIds: Map<string, string[]>,
  activities: Activity[],
  stats: ProcessStats,
  completedAt: string
): void {
  const sourceFile = path.basename(file);

  // Intern owner from file name (e.g. "Ashmita Intern.xlsx" → "Ashmita")
  const internName = path.basename(file).replace(/ Intern\.xlsx$/i, "").trim();
  const internUserId = resolveStaffName(internName) ?? ADMIN_USER_ID;

  for (const row of rows) {
    // Simrika Direct Leads uses " " (space) as the name column
    const phoneRaw = row["Phone"] ?? row[" Phone"] ?? row["  Phone"];
    const p10 = phone10(phoneRaw);
    if (!p10) continue;

    const leadIds = phone10ToLeadIds.get(p10);
    if (!leadIds || leadIds.length === 0) {
      stats.unmatchedPhones.add(p10);
      continue;
    }
    stats.matchedPhones.add(p10);

    // Remark columns — handle various column name variants
    const remarkCols: Array<{ key: string; subject: string; userId: string }> = [
      { key: "Remarks ", subject: "Tele-call remark", userId: internUserId },
      { key: "Remarks", subject: "Tele-call remark", userId: internUserId },
      // Second "Remarks" column appears in Ashmita Sub Prospects (duplicate key becomes plain "Remarks" after xlsx dedup)
      { key: "Counselor Note", subject: "Counselor note", userId: ADMIN_USER_ID },
      { key: "Counsellor Notes", subject: "Counselor note", userId: ADMIN_USER_ID },
      { key: "Counsellor Remarks", subject: "Counselor note", userId: ADMIN_USER_ID },
      { key: "counselor remarks", subject: "Counselor note", userId: ADMIN_USER_ID },
      { key: "__EMPTY", subject: "Tele-call remark", userId: internUserId },
    ];

    for (const leadId of leadIds) {
      for (const { key, subject, userId } of remarkCols) {
        const text = clean(row[key]);
        if (!text) continue;
        collectActivity(activities, leadId, userId, subject, text, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: key, match_key: `phone10:${p10}`,
          intern: internName,
        });
      }
    }
  }
}

// -----------------------------------------------------------------------
// File processing: Type-B Front-desk workbooks
//   Files: Purnima Front Desk.xlsx | kamana Front Desk.xlsx
//   Sheets: Purnima, Kamana
//   Match: phone last-10
// -----------------------------------------------------------------------
function processFrontDeskWb(
  file: string,
  rows: Record<string, unknown>[],
  sheetName: string,
  phone10ToLeadIds: Map<string, string[]>,
  activities: Activity[],
  stats: ProcessStats,
  completedAt: string
): void {
  const sourceFile = path.basename(file);
  const staffUserId = sheetNameToUserId(sheetName) ?? ADMIN_USER_ID;

  for (const row of rows) {
    const p10 = phone10(row["Phone"]);
    if (!p10) continue;

    const leadIds = phone10ToLeadIds.get(p10);
    if (!leadIds || leadIds.length === 0) {
      stats.unmatchedPhones.add(p10);
      continue;
    }
    stats.matchedPhones.add(p10);

    for (const leadId of leadIds) {
      // All remark columns (Remarks + __EMPTY variants for Purnima; dual Remarks for Kamana)
      const remarkCols = ["Remarks ", "Remarks", "__EMPTY", "__EMPTY_1", "__EMPTY_2", "__EMPTY_3"];
      for (const col of remarkCols) {
        const text = clean(row[col]);
        if (!text) continue;
        collectActivity(activities, leadId, staffUserId, "Front desk note", text, completedAt, {
          source_file: sourceFile, sheet: sheetName, column: col, match_key: `phone10:${p10}`,
          staff: sheetName,
        });
      }
    }
  }
}

// -----------------------------------------------------------------------
// Stats tracking
// -----------------------------------------------------------------------
interface ProcessStats {
  matchedCrmIds: Set<string>;
  unmatchedCrmIds: Set<string>;
  matchedPhones: Set<string>;
  unmatchedPhones: Set<string>;
  rowsProcessed: number;
}

function newStats(): ProcessStats {
  return {
    matchedCrmIds: new Set(),
    unmatchedCrmIds: new Set(),
    matchedPhones: new Set(),
    unmatchedPhones: new Set(),
    rowsProcessed: 0,
  };
}

// -----------------------------------------------------------------------
// Route file+sheet to the right processor
// -----------------------------------------------------------------------
function classifyFile(fileName: string): "counselor-wb" | "application-wb" | "intern" | "front-desk" | null {
  const base = path.basename(fileName).toLowerCase();
  if (base.includes("counsellor") || base.includes("counselor")) return "counselor-wb";
  if (base.includes("application")) return "application-wb";
  if (base.includes("intern")) return "intern";
  if (base.includes("front desk") || base.includes("front-desk")) return "front-desk";
  // kamana / purnima files
  if (base.includes("kamana") || base.includes("purnima")) return "front-desk";
  return null;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
async function main() {
  console.log("=".repeat(60));
  console.log("ADMIZZ ACTIVITIES IMPORT");
  console.log("=".repeat(60));
  console.log(`Mode:         ${DRY_RUN ? "DRY RUN (no data will be written)" : FORCE ? "LIVE + FORCE (existing batch deleted first)" : "LIVE IMPORT"}`);
  console.log(`Target DB:    ${SUPABASE_URL}`);
  console.log(`Tenant:       Admizz (${ADMIZZ_TENANT_ID})`);
  console.log(`Import batch: ${IMPORT_BATCH}`);
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

  // ----------------------------------------------------------------
  // 1. Idempotency check (lead_activities with import_batch marker)
  // ----------------------------------------------------------------
  const { count: existingBatchCount } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .contains("metadata", { import_batch: IMPORT_BATCH });

  if ((existingBatchCount ?? 0) > 0) {
    if (!FORCE) {
      console.error(`\nABORT: Found ${existingBatchCount} activities already marked import_batch="${IMPORT_BATCH}".`);
      console.error("Re-run with --force to delete existing and re-import.");
      process.exit(1);
    }
    if (!DRY_RUN) {
      console.log(`\n--force: deleting ${existingBatchCount} existing activities with import_batch="${IMPORT_BATCH}"...`);
      // Delete in batches to avoid timeout
      let deleted = 0;
      while (true) {
        const { data: toDelete } = await supabase
          .from("lead_activities")
          .select("id")
          .eq("tenant_id", ADMIZZ_TENANT_ID)
          .contains("metadata", { import_batch: IMPORT_BATCH })
          .limit(500);
        if (!toDelete || toDelete.length === 0) break;
        const ids = toDelete.map((r) => r.id);
        await supabase.from("lead_activities").delete().in("id", ids);
        deleted += ids.length;
        process.stdout.write(`\r  Deleted ${deleted}...`);
      }
      console.log(`\n  Deleted ${deleted} activities.`);
    }
  }

  // ----------------------------------------------------------------
  // 2. Build lead lookup maps
  // ----------------------------------------------------------------
  console.log("\nBuilding lead lookup maps...");

  // Fetch all non-deleted Admizz leads (staging lists scope)
  const allLeads: { id: string; phone: string | null; assigned_to: string | null; custom_fields: Record<string, unknown>; tags: string[] | null }[] = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, phone, assigned_to, custom_fields, tags")
      .eq("tenant_id", ADMIZZ_TENANT_ID)
      .is("deleted_at", null)
      .range(from, from + CHUNK - 1);
    if (error) { console.error("ERROR fetching leads:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < CHUNK) break;
  }
  console.log(`  Loaded ${allLeads.length} leads.`);

  // crmId (normalized upper) → [lead_id]
  const crmIdToLeadIds = new Map<string, string[]>();
  // phone10 → [lead_id]
  const phone10ToLeadIds = new Map<string, string[]>();
  // lead_id → current data (for conditional updates)
  const leadById = new Map<string, typeof allLeads[0]>();

  for (const lead of allLeads) {
    leadById.set(lead.id, lead);
    const cfCrmId = (lead.custom_fields?.legacy_crm_id as string | undefined)?.trim().toUpperCase();
    if (cfCrmId) {
      const list = crmIdToLeadIds.get(cfCrmId) ?? [];
      list.push(lead.id);
      crmIdToLeadIds.set(cfCrmId, list);
    }
    const p10 = phone10(lead.phone);
    if (p10) {
      const list = phone10ToLeadIds.get(p10) ?? [];
      list.push(lead.id);
      phone10ToLeadIds.set(p10, list);
    }
  }

  console.log(`  CRM ID entries: ${crmIdToLeadIds.size}`);
  console.log(`  Phone10 entries: ${phone10ToLeadIds.size}`);

  // ----------------------------------------------------------------
  // 3. Process all workbooks
  // ----------------------------------------------------------------
  const activities: Activity[] = [];
  const leadUpdates = new Map<string, LeadUpdate>();
  const stats = newStats();
  const completedAt = new Date().toISOString();

  const files = fs.readdirSync(WORKBOOK_DIR)
    .filter((f) => f.endsWith(".xlsx"))
    .sort();

  console.log(`\nProcessing ${files.length} workbooks in ${WORKBOOK_DIR}...`);

  for (const file of files) {
    const filePath = path.join(WORKBOOK_DIR, file);
    const fileType = classifyFile(file);
    if (!fileType) {
      console.log(`  [SKIP] Unknown file type: ${file}`);
      continue;
    }

    const wb = XLSX.readFile(filePath);
    console.log(`\n  FILE: ${file} (${fileType}) — sheets: ${wb.SheetNames.join(", ")}`);

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
      if (rows.length === 0) {
        console.log(`    [${sheetName}] EMPTY — skip`);
        continue;
      }
      stats.rowsProcessed += rows.length;

      const prevActivities = activities.length;
      const prevMatched = stats.matchedCrmIds.size + stats.matchedPhones.size;

      if (fileType === "counselor-wb") {
        processCounselorWb(filePath, rows, sheetName.trim(), crmIdToLeadIds, activities, leadUpdates, stats, completedAt);
      } else if (fileType === "application-wb") {
        processApplicationWb(filePath, rows, sheetName.trim(), crmIdToLeadIds, activities, leadUpdates, stats, completedAt);
      } else if (fileType === "intern") {
        processInternWb(filePath, rows, sheetName.trim(), phone10ToLeadIds, activities, stats, completedAt);
      } else if (fileType === "front-desk") {
        processFrontDeskWb(filePath, rows, sheetName.trim(), phone10ToLeadIds, activities, stats, completedAt);
      }

      const addedActivities = activities.length - prevActivities;
      const newMatched = (stats.matchedCrmIds.size + stats.matchedPhones.size) - prevMatched;
      console.log(`    [${sheetName}] ${rows.length} rows → +${newMatched} matched, +${addedActivities} activities`);
    }
  }

  // ----------------------------------------------------------------
  // 4. Report pre-run stats
  // ----------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("PRE-RUN STATS");
  console.log("=".repeat(60));
  console.log(`  Total rows parsed:          ${stats.rowsProcessed}`);
  console.log(`  CRM IDs matched:            ${stats.matchedCrmIds.size}`);
  console.log(`  CRM IDs unmatched:          ${stats.unmatchedCrmIds.size}`);
  console.log(`  Phone10s matched:           ${stats.matchedPhones.size}`);
  console.log(`  Phone10s unmatched:         ${stats.unmatchedPhones.size}`);
  console.log(`  Activities collected:       ${activities.length}`);
  console.log(`  Lead updates (assign/tag):  ${leadUpdates.size}`);

  if (stats.unmatchedCrmIds.size > 0) {
    console.log(`\n  Unmatched CRM IDs (${stats.unmatchedCrmIds.size}):`);
    for (const id of [...stats.unmatchedCrmIds].sort()) {
      console.log(`    ${id}`);
    }
  }

  if (stats.unmatchedPhones.size > 0) {
    const unmatched = [...stats.unmatchedPhones].sort();
    console.log(`\n  Unmatched phone10s (${unmatched.length}) — first 27:`);
    for (const p of unmatched.slice(0, 27)) {
      console.log(`    ${p}`);
    }
    if (unmatched.length > 27) console.log(`    ... and ${unmatched.length - 27} more`);
  }

  console.log("\n--- Sample activities (first 3) ---");
  for (const a of activities.slice(0, 3)) {
    console.log(JSON.stringify({ lead_id: a.lead_id, subject: a.subject, desc_preview: a.description.slice(0, 80), metadata: a.metadata }, null, 2));
  }

  if (DRY_RUN) {
    console.log("\n✓ Dry run complete. No data was written.");
    return;
  }

  // ----------------------------------------------------------------
  // 5. Before counts
  // ----------------------------------------------------------------
  const { count: actBefore } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID);

  // ----------------------------------------------------------------
  // 6. Insert activities in batches
  // ----------------------------------------------------------------
  console.log(`\nInserting ${activities.length} activities in batches of ${BATCH_SIZE}...`);
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < activities.length; i += BATCH_SIZE) {
    const batch = activities.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.from("lead_activities").insert(batch).select("id");
    if (error) {
      console.error(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      failed += batch.length;
    } else {
      inserted += (data ?? []).length;
    }
    process.stdout.write(`\rProgress: ${Math.min(i + BATCH_SIZE, activities.length)}/${activities.length}  `);
  }
  console.log("");

  // ----------------------------------------------------------------
  // 7. Apply lead updates (assignment + custom_fields patch + tags)
  // ----------------------------------------------------------------
  console.log(`\nApplying ${leadUpdates.size} lead updates...`);
  let assignUpdated = 0;
  let customFieldsUpdated = 0;
  let tagsUpdated = 0;
  let updateFailed = 0;

  for (const upd of leadUpdates.values()) {
    const current = leadById.get(upd.lead_id);
    if (!current) continue;

    const patch: Record<string, unknown> = {};

    // Only assign if currently unassigned
    if (upd.assigned_to && !current.assigned_to) {
      patch.assigned_to = upd.assigned_to;
      assignUpdated++;
    }

    // Merge custom_fields patch
    if (upd.custom_fields_patch && Object.keys(upd.custom_fields_patch).length > 0) {
      const existing = (current.custom_fields ?? {}) as Record<string, unknown>;
      const pa = (existing.pending_application ?? {}) as Record<string, unknown>;
      const newPa = (upd.custom_fields_patch.pending_application ?? {}) as Record<string, unknown>;
      // Merge: don't overwrite existing pa keys unless they come from application wbs (which sets them directly)
      patch.custom_fields = {
        ...existing,
        ...upd.custom_fields_patch,
        pending_application: { ...pa, ...newPa },
      };
      customFieldsUpdated++;
    }

    // Tags: add pending-application-import if not present
    if (upd.add_tag) {
      const existingTags = current.tags ?? [];
      if (!existingTags.includes(upd.add_tag)) {
        patch.tags = [...existingTags, upd.add_tag];
        tagsUpdated++;
      }
    }

    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", upd.lead_id)
      .eq("tenant_id", ADMIZZ_TENANT_ID);

    if (error) {
      console.error(`\nLead update error (${upd.lead_id}):`, error.message);
      updateFailed++;
    }
  }

  // ----------------------------------------------------------------
  // 8. After counts
  // ----------------------------------------------------------------
  const { count: actAfter } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID);

  const { count: batchCount } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .contains("metadata", { import_batch: IMPORT_BATCH });

  // ----------------------------------------------------------------
  // 9. Final report
  // ----------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("IMPORT COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Activities inserted:        ${inserted}`);
  console.log(`  Activities failed:          ${failed}`);
  console.log(`  lead_activities BEFORE:    ${actBefore}`);
  console.log(`  lead_activities AFTER:     ${actAfter}`);
  console.log(`  Batch marker count:        ${batchCount} (import_batch="${IMPORT_BATCH}")`);
  console.log(`  Leads assigned:            ${assignUpdated}`);
  console.log(`  Leads flagged (app data):  ${customFieldsUpdated}`);
  console.log(`  Leads tagged:              ${tagsUpdated}`);
  console.log(`  Lead update errors:        ${updateFailed}`);
  console.log(`\n  CRM IDs matched:           ${stats.matchedCrmIds.size}`);
  console.log(`  CRM IDs unmatched:         ${stats.unmatchedCrmIds.size}`);
  console.log(`  Phone10s matched:          ${stats.matchedPhones.size}`);
  console.log(`  Phone10s unmatched:        ${stats.unmatchedPhones.size}`);

  // Spot-check: 3 loaded activities
  const { data: spotCheck } = await supabase
    .from("lead_activities")
    .select("id, lead_id, subject, description, user_id, metadata")
    .eq("tenant_id", ADMIZZ_TENANT_ID)
    .contains("metadata", { import_batch: IMPORT_BATCH })
    .limit(3);

  console.log("\n--- Spot-check: 3 loaded activities ---");
  for (const row of spotCheck ?? []) {
    console.log(JSON.stringify({ ...row, description: row.description?.slice(0, 80) + "..." }, null, 2));
  }

  if (failed > 0 || updateFailed > 0) {
    console.error(`\nWARNING: ${failed} activity inserts and ${updateFailed} lead updates failed.`);
    process.exit(1);
  }

  console.log("\n✓ Done. STOP — do not push/PR/merge. Opus reviews on stage.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
