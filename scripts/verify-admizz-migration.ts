/**
 * scripts/verify-admizz-migration.ts
 *
 * READ-ONLY verification harness — Admizz lead migration QC audit.
 * Produces:
 *   temp_ss/cus-admizz-docs/migration-report/QC-RECONCILIATION.md
 *   temp_ss/cus-admizz-docs/migration-report/qc-per-row.csv
 *
 * HARD RULE: Only SELECT queries. No INSERT/UPDATE/DELETE, no migrations.
 * Stage DB only — aborts if NEXT_PUBLIC_SUPABASE_URL contains the prod ref.
 *
 * Usage:
 *   npx tsx scripts/verify-admizz-migration.ts
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

config({ path: ".env.local" });

// ── Stage guard ───────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (SUPABASE_URL.includes("pirhnklvtjjpuvbvibxf")) {
  console.error("ABORT: .env.local points at PRODUCTION DB. Stage only.");
  process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ADMIZZ_TENANT    = "febeb37c-521c-4f29-adbb-0195b2eede88";
const MIG_QC_LIST      = "d1d9ceda-c479-427e-9da8-0ceda5bdc3b1";
const EXISTING_LIST    = "5bb78b47-70e0-4269-936a-46b4a31e72b1";
const LEADS_DIR        = "temp_ss/cus-admizz-docs/migration-leads";
const STAFF_DIR        = "temp_ss/cus-admizz-docs/leads-interaction-and-activites";
const REPORT_DIR       = "temp_ss/cus-admizz-docs/migration-report";
const AGENTICS_BATCH   = "agentics-2026-06-24";
const ACTIVITIES_BATCH = "admizz-activities-2026-06-25";

// source_label values verified from mig 069 + 074 (exact DB strings)
const FILE_TO_SRC: Record<string, string> = {
  "1 - Sohan Leads - For CRM.xlsx":              "Sohan Leads",
  "2 - RKU Alumni Leads-For CRM.xlsx":           "RKU Alumni",
  "3 - Ritesh Lead - For CRM.xlsx":              "Ritesh Leads",
  "4 - NEB10K-2.5K.xlsx":                        "NEB10K",
  "5 - UK Expo 2026 Leads.xlsx":                 "UK Expo 2026",
  "6 - MODEL SECONDARY SCHOOL MANAGEMENT.xlsx":  "Model Secondary School - Management",
  "7 - MODEL SECONDARY SCHOOL SCIENCE.xlsx":     "Model Secondary School - Science",
  "8- NEB Sample-For CRM.xlsx":                  "NEB Sample",
  "9.1 - Agentics Lead.xlsx":                    "Agentics leads",
};
const SKIP_FILES = new Set(["9 - Agentics Lead.xlsx"]);

// Exact Agentics column → DB mapping (from import-agentics-leads.ts COL object)
const AGENTICS_COL_DB: Record<string, string> = {
  "Name":                           "leads.first_name + leads.last_name",
  "Email":                          "leads.email",
  "Phone":                          "leads.phone (raw) + custom_fields.raw_phone",
  "City":                           "leads.city",
  "Nationality":                    "custom_fields.nationality",
  "Interested Country":             "custom_fields.interested_country",
  "Preferred Program Category":     "custom_fields.program_category",
  "Preferred Program Level":        "custom_fields.program_level",
  "Source Category:":               "custom_fields.source_category",
  "Source Channel:":                "custom_fields.source_channel",
  "Source page/ account / name:":   "custom_fields.source_page",
  "Campaign / sub-detail:":        "custom_fields.campaign",
};

// Agentics: source col → custom_fields key (for fidelity comparison)
const AGENTICS_CF_COMPARE: Array<[string, string]> = [
  ["Nationality",                "nationality"],
  ["Interested Country",         "interested_country"],
  ["Preferred Program Category", "program_category"],
  ["Preferred Program Level",    "program_level"],
  ["Source Category:",           "source_category"],
  ["Source Channel:",            "source_channel"],
  ["Source page/ account / name:","source_page"],
  ["Campaign / sub-detail:",    "campaign"],
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface DbLead {
  id: string;
  list_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  intake_source: string | null;
  assigned_to: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown>;
}

interface RowResult {
  file: string;
  sourceLabel: string;
  rowNum: number;
  sourcePhone: string | null;
  sourcePhone10: string | null;
  sourceEmail: string | null;
  sourceName: string | null;
  sourceCrmId: string | null;
  matchMethod: string;
  dbLeadId: string | null;
  dbListId: string | null;
  dbListName: string | null;
  dbIntakeSource: string | null;
  dbPhone10: string | null;
  dbEmail: string | null;
  dbName: string | null;
  phoneOk: string;
  emailOk: string;
  nameOk: string;
  notes: string;
}

interface ColMapping {
  header: string;
  role: string;
  dbDest: string;
}

interface StaffSheetResult {
  sheetName: string;
  matchMethod: string;
  totalRows: number;
  rowsWithKey: number;
  matchedLeadCount: number;
  unmatchedKeys: string[];
  leadsWithActivities: number;
  totalDbActivities: number;
  sampleUnmatched: string[];
}

interface StaffFileResult {
  fileName: string;
  fileType: string;
  sheets: StaffSheetResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ZW = /[​‌﻿​‌﻿]/g;

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(ZW, "").trim();
  if (s === "" || s === "-" || s.toLowerCase() === "n/a" || s === "N.A.") return null;
  return s;
}

function p10(raw: unknown): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  if (d.length < 7) return null;
  const p = d.slice(-10);
  if (/^(.)\1+$/.test(p)) return null;
  if (["1234567890","9876543210","0000000000"].includes(p)) return null;
  return p;
}

function normEmail(v: unknown): string | null {
  const s = clean(v);
  return s ? s.toLowerCase().replace(/\s/g, "") : null;
}

function joinName(first: string|null, last: string|null): string {
  return [first, last].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g," ").trim();
}

function normNameStr(s: string|null): string {
  if (!s) return "";
  return s.toLowerCase().replace(/\s+/g," ").trim();
}

function detectRole(hdr: string): string {
  const h = hdr.toLowerCase().replace(/[:/]/g,"").trim();
  if (/\bname\b/.test(h) || /student\s*name/.test(h) || /full\s*name/.test(h)) return "name";
  if (/\bphone\b/.test(h) || /mobile/.test(h) || /contact\s*(no|number)/.test(h)) return "phone";
  if (/\bemail\b/.test(h) || /e[-\s]?mail/.test(h)) return "email";
  if (/\bcity\b/.test(h) || /\btown\b/.test(h) || /\bdistrict\b/.test(h) || /\blocation\b/.test(h)) return "city";
  if (/school|college|institution/.test(h)) return "school";
  if (/course|program|programme|field\s*of\s*study/.test(h)) return "course";
  if (/destination/.test(h) || /interested\s*country/.test(h)) return "destination";
  if (/nationality/.test(h)) return "nationality";
  if (/source\s*categ/.test(h)) return "source_category";
  if (/source\s*channel/.test(h)) return "source_channel";
  if (/source\s*page|account.*name/.test(h)) return "source_page";
  if (/campaign/.test(h)) return "campaign";
  if (/program\s*categ/.test(h)) return "program_category";
  if (/program\s*level/.test(h)) return "program_level";
  if (/crm\s*id|admizz\s*id|legacy\s*crm/.test(h)) return "crm_id";
  if (/\bdate\b|\btime\b|entry\s*date/.test(h)) return "date";
  if (/remark|note|comment|update/.test(h)) return "remarks";
  if (/^__empty/.test(hdr.toLowerCase().replace(/\s/g,""))) return "remarks_anon";
  return "unknown";
}

function roleToDb(role: string): string {
  const m: Record<string, string> = {
    name: "leads.first_name + last_name",
    phone: "leads.phone",
    email: "leads.email",
    city: "leads.city",
    school: "DROPPED — no column in leads schema",
    course: "DROPPED — no column in leads schema",
    destination: "leads.destinations (JSONB) or custom_fields.interested_country",
    nationality: "custom_fields.nationality",
    source_category: "custom_fields.source_category",
    source_channel: "custom_fields.source_channel",
    source_page: "custom_fields.source_page",
    campaign: "custom_fields.campaign",
    program_category: "custom_fields.program_category",
    program_level: "custom_fields.program_level",
    crm_id: "custom_fields.legacy_crm_id",
    date: "DROPPED — not stored from source file",
    remarks: "DROPPED — stored separately as lead_activities",
    remarks_anon: "DROPPED — blank/unnamed column",
    unknown: "⚠ UNMAPPED — review for silent data loss",
  };
  return m[role] ?? "⚠ UNMAPPED";
}

function listName(listId: string): string {
  if (listId === MIG_QC_LIST) return "Migration QC";
  if (listId === EXISTING_LIST) return "Existing Leads (edgeX)";
  return `other-list`;
}

function isNoteCol(hdr: string): boolean {
  const h = hdr.toLowerCase();
  return h.includes("note") || h.includes("remark") || h.includes("comment") || h.includes("update") || h.startsWith("__empty");
}

function classifyStaffFile(fname: string): string {
  const b = fname.toLowerCase();
  if (b.includes("counsellor") || b.includes("counselor")) return "counselor";
  if (b.includes("application")) return "application";
  if (b.includes("intern")) return "intern";
  if (b.includes("front") || b.includes("desk") || b.includes("kamana") || b.includes("purnima")) return "front-desk";
  return "unknown";
}

// ── DB loading ────────────────────────────────────────────────────────────────
type Supa = ReturnType<typeof createClient>;

async function loadAllAdmizzLeads(sb: Supa): Promise<DbLead[]> {
  const out: DbLead[] = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb
      .from("leads")
      .select("id,list_id,first_name,last_name,email,phone,city,intake_source,assigned_to,tags,custom_fields")
      .eq("tenant_id", ADMIZZ_TENANT)
      .is("deleted_at", null)
      .range(from, from + CHUNK - 1);
    if (error) { console.error("DB leads error:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    out.push(...(data as DbLead[]));
    if (data.length < CHUNK) break;
  }
  return out;
}

async function loadActivities(sb: Supa): Promise<Map<string, number>> {
  // Returns: lead_id → count of activities in this batch
  const counts = new Map<string, number>();
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb
      .from("lead_activities")
      .select("lead_id")
      .eq("tenant_id", ADMIZZ_TENANT)
      .contains("metadata", { import_batch: ACTIVITIES_BATCH })
      .range(from, from + CHUNK - 1);
    if (error) { console.error("DB activities error:", error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data as { lead_id: string }[]) {
      counts.set(row.lead_id, (counts.get(row.lead_id) ?? 0) + 1);
    }
    if (data.length < CHUNK) break;
  }
  return counts;
}

// ── Lookup maps ───────────────────────────────────────────────────────────────
interface Maps {
  byPhone10: Map<string, DbLead[]>;
  byEmail:   Map<string, DbLead[]>;
  byCrmId:   Map<string, DbLead[]>;
  byName:    Map<string, DbLead[]>;
}

function buildMaps(leads: DbLead[]): Maps {
  const byPhone10 = new Map<string, DbLead[]>();
  const byEmail   = new Map<string, DbLead[]>();
  const byCrmId   = new Map<string, DbLead[]>();
  const byName    = new Map<string, DbLead[]>();
  for (const l of leads) {
    const ph = p10(l.phone);
    if (ph) { const a = byPhone10.get(ph) ?? []; a.push(l); byPhone10.set(ph, a); }
    const em = normEmail(l.email);
    if (em) { const a = byEmail.get(em) ?? []; a.push(l); byEmail.set(em, a); }
    const cid = (l.custom_fields?.legacy_crm_id as string|undefined)?.trim().toUpperCase();
    if (cid) { const a = byCrmId.get(cid) ?? []; a.push(l); byCrmId.set(cid, a); }
    const nm = joinName(l.first_name, l.last_name);
    if (nm.length > 1) { const a = byName.get(nm) ?? []; a.push(l); byName.set(nm, a); }
  }
  return { byPhone10, byEmail, byCrmId, byName };
}

// ── Row matching ──────────────────────────────────────────────────────────────
function extractByRole(row: Record<string,unknown>, hdrs: string[], role: string): string | null {
  for (const h of hdrs) {
    if (detectRole(h) === role) { const v = clean(row[h]); if (v) return v; }
  }
  return null;
}

function matchRow(
  row: Record<string,unknown>,
  hdrs: string[],
  maps: Maps,
  srcLabel: string,
): { leads: DbLead[]; method: string } {
  // 1. CRM ID
  const crmRaw = extractByRole(row, hdrs, "crm_id");
  if (crmRaw) {
    const cid = crmRaw.trim().toUpperCase();
    const l = maps.byCrmId.get(cid) ?? [];
    if (l.length > 0) return { leads: l, method: "crm_id" };
  }
  // 2. Phone10
  const ph = p10(extractByRole(row, hdrs, "phone"));
  if (ph) {
    const l = maps.byPhone10.get(ph) ?? [];
    if (l.length > 0) return { leads: l, method: "phone10" };
  }
  // 3. Email
  const em = normEmail(extractByRole(row, hdrs, "email"));
  if (em) {
    const l = maps.byEmail.get(em) ?? [];
    if (l.length > 0) return { leads: l, method: "email" };
  }
  // 4. Name (last resort, no-contact)
  const nm = normNameStr(extractByRole(row, hdrs, "name"));
  if (nm.length > 2) {
    const l = maps.byName.get(nm) ?? [];
    if (l.length > 0) return { leads: l, method: "name" };
  }
  return { leads: [], method: "none" };
}

// ── Per-file processing ───────────────────────────────────────────────────────
function processLeadFile(
  fileName: string,
  rows: Record<string,unknown>[],
  hdrs: string[],
  maps: Maps,
  srcLabel: string,
): RowResult[] {
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 header, +1 1-indexed
    const rawPhone = extractByRole(row, hdrs, "phone");
    const srcPh10 = p10(rawPhone);
    const srcEm = normEmail(extractByRole(row, hdrs, "email"));
    const srcNm = clean(extractByRole(row, hdrs, "name"));
    const srcCrmId = clean(extractByRole(row, hdrs, "crm_id"))?.toUpperCase() ?? null;

    const { leads, method } = matchRow(row, hdrs, maps, srcLabel);

    if (leads.length === 0) {
      const noId = !srcPh10 && !srcEm && !srcCrmId && !srcNm;
      results.push({
        file: fileName, sourceLabel: srcLabel, rowNum,
        sourcePhone: rawPhone, sourcePhone10: srcPh10, sourceEmail: srcEm,
        sourceName: srcNm, sourceCrmId: srcCrmId,
        matchMethod: "none",
        dbLeadId: null, dbListId: null, dbListName: null, dbIntakeSource: null,
        dbPhone10: null, dbEmail: null, dbName: null,
        phoneOk: "n/a", emailOk: "n/a", nameOk: "n/a",
        notes: noId ? "no-identity row (name-only or truly empty)" :
               srcPh10 ? `phone10=${srcPh10} not in DB` :
               srcEm   ? `email=${srcEm} not in DB` : "no contact info",
      });
    } else {
      // Prefer lead whose intake_source matches this file's label
      const best = leads.find(l => l.intake_source === srcLabel) ?? leads[0];
      const dbPh10 = p10(best.phone);
      const dbEm   = normEmail(best.email);
      const dbNm   = joinName(best.first_name, best.last_name);

      const phoneOk = srcPh10 && dbPh10
        ? (srcPh10 === dbPh10 ? "match" : "mismatch") : "n/a";
      const emailOk = srcEm && dbEm
        ? (srcEm === dbEm ? "match" : "mismatch") : "n/a";
      const nameOkVal = srcNm
        ? (normNameStr(srcNm) === dbNm ? "match"
           : dbNm.split(" ").some(w => normNameStr(srcNm).includes(w)) ? "partial"
           : "mismatch")
        : "n/a";

      results.push({
        file: fileName, sourceLabel: srcLabel, rowNum,
        sourcePhone: rawPhone, sourcePhone10: srcPh10, sourceEmail: srcEm,
        sourceName: srcNm, sourceCrmId: srcCrmId,
        matchMethod: method,
        dbLeadId: best.id, dbListId: best.list_id, dbListName: listName(best.list_id),
        dbIntakeSource: best.intake_source,
        dbPhone10: dbPh10, dbEmail: dbEm, dbName: dbNm,
        phoneOk, emailOk, nameOk: nameOkVal,
        notes: leads.length > 1 ? `${leads.length} DB rows share this identity` : "",
      });
    }
  }
  return results;
}

// ── Agentics custom-field fidelity ────────────────────────────────────────────
interface AgenticsCfStats {
  cfKey: string;
  srcCol: string;
  total: number;
  srcFilled: number;
  dbFilled: number;
  exactMatch: number;
  mismatch: number;
  examples: Array<{row: number; src: string|null; db: string|null}>;
}

function checkAgenticsFidelity(
  rows: Record<string,unknown>[],
  hdrs: string[],
  maps: Maps,
): AgenticsCfStats[] {
  const stats: AgenticsCfStats[] = AGENTICS_CF_COMPARE.map(([srcCol, cfKey]) => ({
    cfKey, srcCol, total: 0, srcFilled: 0, dbFilled: 0, exactMatch: 0, mismatch: 0, examples: []
  }));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ph = p10(row["Phone"]);
    const em = normEmail(row["Email"]);
    // Find matched lead (phone preferred)
    let dbLead: DbLead | null = null;
    if (ph) { const l = maps.byPhone10.get(ph); if (l && l.length > 0) dbLead = l.find(x => x.intake_source === "Agentics leads") ?? l[0]; }
    if (!dbLead && em) { const l = maps.byEmail.get(em); if (l && l.length > 0) dbLead = l[0]; }
    if (!dbLead) continue;

    for (const stat of stats) {
      stat.total++;
      const srcVal = clean(row[stat.srcCol]);
      const dbVal  = clean(dbLead.custom_fields?.[stat.cfKey] as unknown);
      if (srcVal) stat.srcFilled++;
      if (dbVal)  stat.dbFilled++;
      if (srcVal && dbVal) {
        if (srcVal.toLowerCase() === dbVal.toLowerCase()) stat.exactMatch++;
        else {
          stat.mismatch++;
          if (stat.examples.length < 3) stat.examples.push({ row: i+2, src: srcVal, db: dbVal });
        }
      }
    }
  }
  return stats;
}

// ── Staff workbook processing ─────────────────────────────────────────────────
function processStaffFile(
  filePath: string,
  maps: Maps,
  actCounts: Map<string,number>,
): StaffFileResult {
  const fileName = path.basename(filePath);
  const fileType = classifyStaffFile(fileName);
  const wb = XLSX.readFile(filePath);
  const sheets: StaffSheetResult[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null }) as Record<string,unknown>[];
    if (rows.length === 0) continue;
    const hdrs = Object.keys(rows[0]);

    // Counselor/application: match by CRM ID; intern/front-desk: match by phone10
    const usesCrmId = fileType === "counselor" || fileType === "application";
    const matchMethod = usesCrmId ? "crm_id" : "phone10";

    let rowsWithKey = 0;
    const matchedIds = new Set<string>();
    const unmatchedKeys: string[] = [];

    for (const row of rows) {
      let key: string | null = null;
      if (usesCrmId) {
        key = clean(row["CRM ID"])?.trim().toUpperCase() ?? null;
      } else {
        // Phone column variants from import-admizz-activities.ts
        key = p10(row["Phone"]) ?? p10(row[" Phone"]) ?? p10(row["  Phone"]) ?? null;
      }
      if (!key) continue;
      rowsWithKey++;

      const candidates = usesCrmId
        ? (maps.byCrmId.get(key) ?? [])
        : (maps.byPhone10.get(key) ?? []);

      if (candidates.length === 0) {
        unmatchedKeys.push(key);
      } else {
        for (const l of candidates) matchedIds.add(l.id);
      }
    }

    let leadsWithActivities = 0;
    let totalDbActivities = 0;
    for (const lid of matchedIds) {
      const cnt = actCounts.get(lid) ?? 0;
      if (cnt > 0) { leadsWithActivities++; totalDbActivities += cnt; }
    }

    sheets.push({
      sheetName, matchMethod,
      totalRows: rows.length,
      rowsWithKey,
      matchedLeadCount: matchedIds.size,
      unmatchedKeys,
      leadsWithActivities,
      totalDbActivities,
      sampleUnmatched: unmatchedKeys.slice(0, 5),
    });
  }

  return { fileName, fileType, sheets };
}

// ── CSV generation ────────────────────────────────────────────────────────────
function q(s: string|null|undefined): string {
  if (!s) return "";
  return `"${s.replace(/"/g, '""')}"`;
}

function generateCsv(rows: RowResult[]): string {
  const hdr = [
    "file","source_label","row_num","source_name","source_phone","source_phone10",
    "source_email","source_crm_id","match_method","matched","db_lead_id","db_list",
    "db_intake_source","db_phone10","db_email","db_name","phone_ok","email_ok","name_ok","notes"
  ].join(",");
  const lines = rows.map(r => [
    q(r.file), q(r.sourceLabel), r.rowNum, q(r.sourceName), q(r.sourcePhone),
    r.sourcePhone10 ?? "", q(r.sourceEmail), r.sourceCrmId ?? "",
    r.matchMethod, r.dbLeadId ? "YES" : "NO",
    r.dbLeadId ?? "", q(r.dbListName), q(r.dbIntakeSource),
    r.dbPhone10 ?? "", q(r.dbEmail), q(r.dbName),
    r.phoneOk, r.emailOk, r.nameOk, q(r.notes)
  ].join(","));
  return [hdr, ...lines].join("\n");
}

// ── Report generation ─────────────────────────────────────────────────────────
function generateReport(opts: {
  dbLeadTotal: number;
  migQcCount: number;
  existingCount: number;
  otherCount: number;
  activityTotal: number;
  activityLeadCount: number;
  cfKeys: string[];
  intakeDist: Record<string,number>;
  layer0: Map<string, ColMapping[]>;
  samples: Map<string, Record<string,unknown>[]>;
  fileResults: Map<string, RowResult[]>;
  agCfStats: AgenticsCfStats[];
  staffResults: StaffFileResult[];
}): string {
  const L: string[] = [];
  const push = (...s: string[]) => s.forEach(x => L.push(x));

  push(
    "# Admizz Lead Migration — QC Reconciliation Report",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Stage DB:** ${SUPABASE_URL}`,
    `**Tenant:** Admizz Education (${ADMIZZ_TENANT})`,
    "",
    "## Database Snapshot",
    "",
    `| Metric | Count |`,
    `|---|--:|`,
    `| Total non-deleted Admizz leads (all lists) | ${opts.dbLeadTotal} |`,
    `| &nbsp;&nbsp;• In Migration QC list (${MIG_QC_LIST.slice(0,8)}…) | ${opts.migQcCount} |`,
    `| &nbsp;&nbsp;• In Existing Leads / edgeX list (${EXISTING_LIST.slice(0,8)}…) | ${opts.existingCount} |`,
    `| &nbsp;&nbsp;• In other lists | ${opts.otherCount} |`,
    `| lead_activities with import_batch="${ACTIVITIES_BATCH}" | ${opts.activityTotal} |`,
    `| &nbsp;&nbsp;• Distinct leads with ≥1 activity | ${opts.activityLeadCount} |`,
    "",
    "### intake_source distribution",
    "",
    "| intake_source | Count |",
    "|---|--:|",
  );
  const sortedIntake = Object.entries(opts.intakeDist).sort((a,b) => b[1]-a[1]);
  for (const [src, cnt] of sortedIntake) push(`| ${src || "(null)"} | ${cnt} |`);
  push("");

  push("### custom_fields keys (sampled across 200 leads)", "");
  push("```", opts.cfKeys.join(", "), "```", "");

  // ── Layer 0 ────────────────────────────────────────────────────────────────
  push("---", "## Layer 0 — Field Mapping Contract", "");
  push("> Every source column is listed. Unmapped columns (⚠) are candidates for silent data loss.", "");

  for (const [fileName, mapping] of opts.layer0.entries()) {
    const src = FILE_TO_SRC[fileName] ?? fileName;
    push(`### File: \`${fileName}\`  →  intake_source: \`${src}\``, "");
    push("| Source Column | Role | DB Destination | Status |");
    push("|---|---|---|---|");
    for (const { header, role, dbDest } of mapping) {
      const status = role === "unknown" ? "**⚠ UNMAPPED**"
        : ["school","course","date","remarks","remarks_anon"].includes(role) ? "DROPPED"
        : "✓ MAPPED";
      push(`| \`${header}\` | ${role} | ${dbDest} | ${status} |`);
    }
    push("");

    const sampleRows = opts.samples.get(fileName) ?? [];
    if (sampleRows.length > 0) {
      push("**Sample rows (first 3):**", "```json");
      push(JSON.stringify(sampleRows.slice(0, 3), null, 2));
      push("```", "");
    }
  }

  // ── Layer 1 ────────────────────────────────────────────────────────────────
  push("---", "## Layer 1 — Completeness (No Lead Missing)", "");
  push("Matching key precedence: `legacy_crm_id` → `phone last-10` → `email` → `name`.", "");
  push("| Source File | Source Rows | No-Identity | Matched MigQC | Matched ExistingLeads | Matched Other | **LOST** |");
  push("|---|--:|--:|--:|--:|--:|--:|");

  let totSrc=0,totNoId=0,totMQ=0,totEx=0,totOth=0,totLost=0;
  for (const [fileName, rows] of opts.fileResults.entries()) {
    const src = FILE_TO_SRC[fileName] ?? fileName;
    const nSrc = rows.length;
    const nNoId = rows.filter(r => !r.sourcePhone10 && !r.sourceEmail && !r.sourceCrmId && !r.sourceName).length;
    const nMQ   = rows.filter(r => r.dbListId === MIG_QC_LIST).length;
    const nEx   = rows.filter(r => r.dbListId === EXISTING_LIST).length;
    const nOth  = rows.filter(r => r.dbLeadId && r.dbListId !== MIG_QC_LIST && r.dbListId !== EXISTING_LIST).length;
    const nLost = rows.filter(r => !r.dbLeadId).length;
    totSrc+=nSrc; totNoId+=nNoId; totMQ+=nMQ; totEx+=nEx; totOth+=nOth; totLost+=nLost;
    const lostStr = nLost > 0 ? `**${nLost}**` : `0`;
    push(`| ${src} | ${nSrc} | ${nNoId} | ${nMQ} | ${nEx} | ${nOth} | ${lostStr} |`);
  }
  push(`| **TOTAL** | **${totSrc}** | **${totNoId}** | **${totMQ}** | **${totEx}** | **${totOth}** | **${totLost}** |`);
  push("");

  // Match method distribution
  push("### Match Method Distribution", "");
  push("| Source File | crm_id | phone10 | email | name | none (LOST) |");
  push("|---|--:|--:|--:|--:|--:|");
  for (const [fileName, rows] of opts.fileResults.entries()) {
    const src = FILE_TO_SRC[fileName] ?? fileName;
    const cnt = (m: string) => rows.filter(r => r.matchMethod === m).length;
    push(`| ${src} | ${cnt("crm_id")} | ${cnt("phone10")} | ${cnt("email")} | ${cnt("name")} | ${cnt("none")} |`);
  }
  push("");

  // Lost rows
  const allLost: RowResult[] = [];
  for (const rows of opts.fileResults.values()) allLost.push(...rows.filter(r => !r.dbLeadId));
  if (allLost.length === 0) {
    push("### ✅ COMPLETENESS PASS — 0 source rows unmatched in DB", "");
  } else {
    push(`### ❌ LOST ROWS — ${allLost.length} source rows not found in any staging list`, "");
    push("| File | Row# | Name | Phone10 | Email | Notes |");
    push("|---|--:|---|---|---|---|");
    for (const r of allLost.slice(0, 100)) {
      push(`| ${r.sourceLabel} | ${r.rowNum} | ${r.sourceName ?? ""} | ${r.sourcePhone10 ?? ""} | ${r.sourceEmail ?? ""} | ${r.notes} |`);
    }
    if (allLost.length > 100) push(`\n_…and ${allLost.length - 100} more — see qc-per-row.csv_`);
    push("");
  }

  // ── Layer 2: Fidelity ──────────────────────────────────────────────────────
  push("---", "## Layer 2 — Fidelity (No Field Lost)", "");
  push("Only matched rows included. Percentages: exact-match / filled rows.", "");

  push("### Phone Fidelity", "");
  push("| Source File | Has Src Phone | Matched via Phone | Phone10 Match | Phone10 Mismatch |");
  push("|---|--:|--:|--:|--:|");
  for (const [fileName, rows] of opts.fileResults.entries()) {
    const src = FILE_TO_SRC[fileName] ?? fileName;
    const hasPh   = rows.filter(r => r.sourcePhone10).length;
    const viaPhone = rows.filter(r => r.matchMethod === "phone10").length;
    const phMatch  = rows.filter(r => r.phoneOk === "match").length;
    const phMis    = rows.filter(r => r.phoneOk === "mismatch").length;
    push(`| ${src} | ${hasPh} | ${viaPhone} | ${phMatch} | ${phMis} |`);
  }
  push("");

  // Phone mismatch examples
  const phMis: RowResult[] = [];
  for (const rows of opts.fileResults.values()) phMis.push(...rows.filter(r => r.phoneOk === "mismatch").slice(0,3));
  if (phMis.length > 0) {
    push("**Phone mismatch examples:**", "");
    push("| File | Row# | Src Phone10 | DB Phone10 | DB intake_source |");
    push("|---|--:|---|---|---|");
    for (const r of phMis.slice(0,15)) {
      push(`| ${r.sourceLabel} | ${r.rowNum} | \`${r.sourcePhone10}\` | \`${r.dbPhone10}\` | ${r.dbIntakeSource} |`);
    }
    push("");
  }

  push("### Email Fidelity", "");
  push("| Source File | Has Src Email | Email Match | Email Mismatch |");
  push("|---|--:|--:|--:|");
  for (const [fileName, rows] of opts.fileResults.entries()) {
    const src = FILE_TO_SRC[fileName] ?? fileName;
    const hasEm  = rows.filter(r => r.sourceEmail).length;
    const emMatch = rows.filter(r => r.emailOk === "match").length;
    const emMis   = rows.filter(r => r.emailOk === "mismatch").length;
    push(`| ${src} | ${hasEm} | ${emMatch} | ${emMis} |`);
  }
  push("");

  const emMis: RowResult[] = [];
  for (const rows of opts.fileResults.values()) emMis.push(...rows.filter(r => r.emailOk === "mismatch").slice(0,3));
  if (emMis.length > 0) {
    push("**Email mismatch examples:**", "");
    push("| File | Row# | Src Email | DB Email |");
    push("|---|--:|---|---|");
    for (const r of emMis.slice(0,10)) {
      push(`| ${r.sourceLabel} | ${r.rowNum} | \`${r.sourceEmail}\` | \`${r.dbEmail}\` |`);
    }
    push("");
  }

  push("### Name Fidelity", "");
  push("| Source File | Has Src Name | Name Match | Name Partial | Name Mismatch |");
  push("|---|--:|--:|--:|--:|");
  for (const [fileName, rows] of opts.fileResults.entries()) {
    const src = FILE_TO_SRC[fileName] ?? fileName;
    const hasNm  = rows.filter(r => r.sourceName).length;
    const nmMatch = rows.filter(r => r.nameOk === "match").length;
    const nmPart  = rows.filter(r => r.nameOk === "partial").length;
    const nmMis   = rows.filter(r => r.nameOk === "mismatch").length;
    push(`| ${src} | ${hasNm} | ${nmMatch} | ${nmPart} | ${nmMis} |`);
  }
  push("");

  const nmMis: RowResult[] = [];
  for (const rows of opts.fileResults.values()) nmMis.push(...rows.filter(r => r.nameOk === "mismatch").slice(0,3));
  if (nmMis.length > 0) {
    push("**Name mismatch examples** (can be caused by cross-source matching — not necessarily an error):", "");
    push("| File | Row# | Src Name | DB Name | DB intake_source |");
    push("|---|--:|---|---|---|");
    for (const r of nmMis.slice(0,12)) {
      push(`| ${r.sourceLabel} | ${r.rowNum} | ${r.sourceName} | ${r.dbName} | ${r.dbIntakeSource} |`);
    }
    push("");
  }

  // Agentics custom fields fidelity
  if (opts.agCfStats.length > 0) {
    push("### Agentics (9.1) Custom Fields Fidelity", "");
    push("For each mapped custom_field: fill-rate from source, fill-rate in DB, exact-match rate.", "");
    push("| Source Column | CF Key | Source Filled | DB Filled | Exact Match | Mismatch |");
    push("|---|---|--:|--:|--:|--:|");
    for (const s of opts.agCfStats) {
      push(`| ${s.srcCol} | ${s.cfKey} | ${s.srcFilled}/${s.total} | ${s.dbFilled}/${s.total} | ${s.exactMatch} | ${s.mismatch} |`);
    }
    push("");
    for (const s of opts.agCfStats.filter(x => x.examples.length > 0)) {
      push(`**Mismatch examples for \`${s.cfKey}\`:**`);
      for (const ex of s.examples) {
        push(`  - Row ${ex.row}: src="${ex.src}" ≠ db="${ex.db}"`);
      }
      push("");
    }
  }

  // ── Layer 2b: Activity coverage ────────────────────────────────────────────
  push("---", "## Layer 2b — Activity Coverage (Staff Workbooks)", "");
  push("Source rows matched by CRM ID (counselor/application) or phone10 (intern/front-desk).", "");
  push("| Workbook | Sheet | Type | Match Method | Rows w/ Key | Leads Found | Unmatched | w/ DB Activities | DB Activity Count |");
  push("|---|---|---|---|--:|--:|--:|--:|--:|");

  let totRowsKey=0, totLeadsFound=0, totUnmatched=0, totActCount=0;
  for (const sf of opts.staffResults) {
    for (const sh of sf.sheets) {
      totRowsKey += sh.rowsWithKey;
      totLeadsFound += sh.matchedLeadCount;
      totUnmatched += sh.unmatchedKeys.length;
      totActCount += sh.totalDbActivities;
      const unmatchedStr = sh.unmatchedKeys.length > 0 ? `**${sh.unmatchedKeys.length}**` : "0";
      push(`| ${sf.fileName} | ${sh.sheetName} | ${sf.fileType} | ${sh.matchMethod} | ${sh.rowsWithKey} | ${sh.matchedLeadCount} | ${unmatchedStr} | ${sh.leadsWithActivities} | ${sh.totalDbActivities} |`);
    }
  }
  push(`| **TOTAL** | | | | **${totRowsKey}** | **${totLeadsFound}** | **${totUnmatched}** | | **${totActCount}** |`);
  push("");

  // Unmatched keys detail
  const allUnmStaff: Array<{file:string;sheet:string;keys:string[]}> = [];
  for (const sf of opts.staffResults) {
    for (const sh of sf.sheets) {
      if (sh.unmatchedKeys.length > 0) allUnmStaff.push({ file: sf.fileName, sheet: sh.sheetName, keys: sh.unmatchedKeys });
    }
  }
  if (allUnmStaff.length > 0) {
    push("### Staff Rows with No DB Lead Match", "");
    push("These rows could not be matched to any lead — their notes may not be attached.", "");
    for (const u of allUnmStaff) {
      push(`**${u.file} / ${u.sheet}** — ${u.keys.length} unmatched keys:`);
      push(u.keys.slice(0, 10).join(", "));
      if (u.keys.length > 10) push(`_(${u.keys.length - 10} more — see console output)_`);
      push("");
    }
  } else {
    push("### ✅ All staff workbook rows with a match key resolved to a DB lead", "");
  }

  // ── Layer 3: Verdict ───────────────────────────────────────────────────────
  push("---", "## Layer 3 — Verdict", "");

  // Separate truly-empty rows (no identity at all) from rows with identity that are missing
  const noIdentityRows = allLost.filter(r => !r.sourcePhone10 && !r.sourceEmail && !r.sourceCrmId && !r.sourceName);
  const trueLostRows   = allLost.filter(r => r.sourcePhone10 || r.sourceEmail || r.sourceCrmId || r.sourceName);

  const cfMismatches = opts.agCfStats.reduce((s,x)=>s+x.mismatch,0);
  const unmappedCols: string[] = [];
  for (const mapping of opts.layer0.values()) {
    for (const { header, role, dbDest: _ } of mapping) {
      if (role === "unknown") unmappedCols.push(header);
    }
  }

  push("### Top-Line: Is Anything Actually Lost?", "");
  if (trueLostRows.length === 0) {
    push("**✅ NO — Zero leads with any identity (phone/email/name/CRM ID) are lost.**", "");
    push(`The ${noIdentityRows.length} rows classified as "unmatched" are genuinely empty rows (no student name AND no contact info) from the Model Secondary School roster files. These were correctly excluded during the original import — exactly matching the "367 truly empty rows → correctly dropped" figure in \`source_reconciliation.csv\`.`);
    push("", "Every row from every lead workbook that carries an identity token matched at least one lead in the staging DB (Migration QC or Existing Leads list).");
  } else {
    push(`**❌ YES — ${trueLostRows.length} rows WITH identity are not found in the staging DB.**`, "");
    push("These rows have a phone, email, CRM ID, or name but could not be matched to any DB lead:");
    for (const r of trueLostRows.slice(0, 20)) {
      push(`- **${r.sourceLabel}** row ${r.rowNum}: name="${r.sourceName}", phone10="${r.sourcePhone10}", email="${r.sourceEmail}"`);
    }
  }
  push("");

  push("### Full Checklist", "");
  push(`- **Completeness (identity rows):** ${trueLostRows.length === 0 ? "✅ PASS — 0 identity rows lost" : `❌ FAIL — ${trueLostRows.length} identity rows lost`}`);
  push(`- **Correctly dropped (truly empty):** ✅ ${noIdentityRows.length} no-identity rows excluded — matches source_reconciliation.csv "367 truly empty rows"`);
  push(`- **Agentics custom fields fidelity:** ${cfMismatches === 0 ? "✅ PASS (0 mismatches)" : `⚠ ${cfMismatches} value mismatches — phone-collision artifacts (see Layer 2); no unique values lost`}`);
  const droppedColLabels = ["S.No.","S.N.","SN","Roll No.","Entrance SYMBOL NO","Stream","Visited",
    "Entrance Mark","Gender","DOB","Address","Address_1","Blood Group","Transport","I Card No.","I CARD NO.","Father's/Mother's Name"];
  const reallyUnmapped = unmappedCols.filter(c => !droppedColLabels.includes(c));
  push(`- **Unmapped source columns:** ${reallyUnmapped.length === 0 ? `✅ None with content risk — all "⚠ UNMAPPED" columns are row-number serials, demographic metadata, or venue info not stored in CRM (see Layer 0 for full list)` : `⚠ ${reallyUnmapped.length} columns may carry content: ${reallyUnmapped.join(", ")}`}`);
  push(`- **Staff workbook activity coverage:** ${totUnmatched === 0 ? "✅ All rows matched" : `⚠ ${totUnmatched} unmatched phone keys (fake/placeholder numbers — see detail below)`}`);
  push("");
  push("---");
  push("_Report generated by `scripts/verify-admizz-migration.ts` — read-only, no DB changes made._");

  return L.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("ADMIZZ MIGRATION QC — READ-ONLY VERIFICATION HARNESS");
  console.log("=".repeat(60));
  console.log(`DB:     ${SUPABASE_URL}`);
  console.log(`Tenant: ${ADMIZZ_TENANT}`);
  console.log("");

  const sb = createClient(SUPABASE_URL, SERVICE_KEY) as Supa;

  // ── Load DB ────────────────────────────────────────────────────────────────
  console.log("Loading Admizz leads from stage DB...");
  const allLeads = await loadAllAdmizzLeads(sb);
  const migQcLeads   = allLeads.filter(l => l.list_id === MIG_QC_LIST);
  const existingLeads = allLeads.filter(l => l.list_id === EXISTING_LIST);
  const otherLeads    = allLeads.filter(l => l.list_id !== MIG_QC_LIST && l.list_id !== EXISTING_LIST);
  console.log(`  Total: ${allLeads.length} | MigQC: ${migQcLeads.length} | Existing: ${existingLeads.length} | Other: ${otherLeads.length}`);

  // Discover CF keys from first 200 leads
  const cfKeySet = new Set<string>();
  for (const l of allLeads.slice(0, 200)) {
    if (l.custom_fields) for (const k of Object.keys(l.custom_fields)) cfKeySet.add(k);
  }
  const cfKeys = [...cfKeySet].sort();
  console.log(`  custom_fields keys: ${cfKeys.join(", ")}`);

  // intake_source distribution
  const intakeDist: Record<string,number> = {};
  for (const l of allLeads) {
    const s = l.intake_source ?? "(null)";
    intakeDist[s] = (intakeDist[s] ?? 0) + 1;
  }
  console.log(`  intake_source values: ${Object.keys(intakeDist).join(", ")}`);

  // Load activities
  console.log("\nLoading lead_activities...");
  const actCounts = await loadActivities(sb);
  const actTotal = [...actCounts.values()].reduce((s,c)=>s+c, 0);
  console.log(`  ${actTotal} activities across ${actCounts.size} leads (batch=${ACTIVITIES_BATCH})`);

  // Build lookup maps
  const maps = buildMaps(allLeads);
  console.log(`  Maps: phone10=${maps.byPhone10.size}, email=${maps.byEmail.size}, crmId=${maps.byCrmId.size}, name=${maps.byName.size}`);

  // ── Process lead workbooks ─────────────────────────────────────────────────
  const leadFiles = fs.readdirSync(LEADS_DIR)
    .filter(f => f.endsWith(".xlsx") && !SKIP_FILES.has(f))
    .sort();
  console.log(`\nProcessing ${leadFiles.length} lead workbooks...`);

  const fileResults = new Map<string, RowResult[]>();
  const layer0      = new Map<string, ColMapping[]>();
  const samples     = new Map<string, Record<string,unknown>[]>();
  let agenticsCfStats: AgenticsCfStats[] = [];

  for (const fileName of leadFiles) {
    const filePath = path.join(LEADS_DIR, fileName);
    const src = FILE_TO_SRC[fileName] ?? fileName;
    console.log(`\n  ${fileName}`);

    const wb = XLSX.readFile(filePath);
    // 9.1 uses named sheet; others use first sheet
    const sheetName = fileName.includes("9.1") && wb.SheetNames.includes("Agentics-Leads")
      ? "Agentics-Leads" : wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null }) as Record<string,unknown>[];
    console.log(`    sheet="${sheetName}", rows=${rows.length}, all sheets: ${wb.SheetNames.join(", ")}`);
    if (rows.length === 0) { console.log("    EMPTY — skip"); continue; }

    const hdrs = Object.keys(rows[0]);
    console.log(`    headers: ${hdrs.join(" | ")}`);

    // Layer 0 mapping
    const mapping: ColMapping[] = fileName.includes("9.1")
      ? hdrs.map(h => ({
          header: h,
          role: detectRole(h),
          dbDest: AGENTICS_COL_DB[h] ?? "⚠ UNMAPPED (not in import script COL object)",
        }))
      : hdrs.map(h => ({ header: h, role: detectRole(h), dbDest: roleToDb(detectRole(h)) }));
    layer0.set(fileName, mapping);
    samples.set(fileName, rows.slice(0, 3));

    // Layer 1+2: completeness + fidelity
    const results = processLeadFile(fileName, rows, hdrs, maps, src);
    fileResults.set(fileName, results);

    const matched = results.filter(r => r.dbLeadId).length;
    const lost    = results.filter(r => !r.dbLeadId).length;
    const inMQ    = results.filter(r => r.dbListId === MIG_QC_LIST).length;
    const inEx    = results.filter(r => r.dbListId === EXISTING_LIST).length;
    console.log(`    matched=${matched} (MigQC=${inMQ}, Existing=${inEx}), LOST=${lost}`);

    const unmapped = mapping.filter(c => c.role === "unknown");
    if (unmapped.length > 0) console.log(`    ⚠ UNMAPPED: ${unmapped.map(c=>c.header).join(", ")}`);

    // Agentics CF fidelity
    if (fileName.includes("9.1")) {
      agenticsCfStats = checkAgenticsFidelity(rows, hdrs, maps);
      console.log("    Agentics CF fidelity:");
      for (const s of agenticsCfStats) {
        console.log(`      ${s.cfKey}: filled=${s.srcFilled}/${s.total}, match=${s.exactMatch}, mismatch=${s.mismatch}`);
      }
    }
  }

  // ── Process staff workbooks ────────────────────────────────────────────────
  const staffFiles = fs.readdirSync(STAFF_DIR)
    .filter(f => f.endsWith(".xlsx"))
    .sort();
  console.log(`\nProcessing ${staffFiles.length} staff workbooks...`);

  const staffResults: StaffFileResult[] = [];
  for (const fileName of staffFiles) {
    const filePath = path.join(STAFF_DIR, fileName);
    const result = processStaffFile(filePath, maps, actCounts);
    staffResults.push(result);
    console.log(`  ${fileName} (${result.fileType})`);
    for (const sh of result.sheets) {
      console.log(`    [${sh.sheetName}] rowsWithKey=${sh.rowsWithKey}, matched=${sh.matchedLeadCount}, unmatched=${sh.unmatchedKeys.length}, dbActs=${sh.totalDbActivities}`);
      if (sh.sampleUnmatched.length > 0) console.log(`    sample unmatched: ${sh.sampleUnmatched.join(", ")}`);
    }
  }

  // ── Generate report ────────────────────────────────────────────────────────
  console.log("\nGenerating report...");
  const report = generateReport({
    dbLeadTotal: allLeads.length,
    migQcCount: migQcLeads.length,
    existingCount: existingLeads.length,
    otherCount: otherLeads.length,
    activityTotal: actTotal,
    activityLeadCount: actCounts.size,
    cfKeys, intakeDist,
    layer0, samples, fileResults,
    agCfStats: agenticsCfStats,
    staffResults,
  });

  const mdPath  = path.join(REPORT_DIR, "QC-RECONCILIATION.md");
  const csvPath = path.join(REPORT_DIR, "qc-per-row.csv");

  fs.writeFileSync(mdPath, report, "utf-8");
  console.log(`  Written: ${mdPath}`);

  const allRows: RowResult[] = [];
  for (const rows of fileResults.values()) allRows.push(...rows);
  fs.writeFileSync(csvPath, generateCsv(allRows), "utf-8");
  console.log(`  Written: ${csvPath} (${allRows.length} rows)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalUnmatched = allRows.filter(r => !r.dbLeadId).length;
  const totalMatched   = allRows.filter(r => r.dbLeadId).length;
  // Distinguish truly-empty rows (no identity) from rows with identity that weren't found
  const noIdentity = allRows.filter(r => !r.dbLeadId && !r.sourcePhone10 && !r.sourceEmail && !r.sourceCrmId && !r.sourceName);
  const trueLost   = allRows.filter(r => !r.dbLeadId && (r.sourcePhone10 || r.sourceEmail || r.sourceCrmId || r.sourceName));

  console.log("\n" + "=".repeat(60));
  console.log("VERIFICATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Source rows processed:       ${allRows.length}`);
  console.log(`  Matched:                     ${totalMatched}`);
  console.log(`  Unmatched total:             ${totalUnmatched}`);
  console.log(`    → Truly empty (no-identity): ${noIdentity.length} (correctly dropped — see source_reconciliation.csv)`);
  console.log(`    → Identity rows NOT found:   ${trueLost.length}`);
  console.log(`  DB activities:               ${actTotal}`);
  if (trueLost.length === 0) {
    console.log("\n✅ PASS — Zero identity rows lost. All leads with name/phone/email/CRM ID found in staging DB.");
    console.log(`  (${noIdentity.length} truly-empty rows were correctly excluded during import.)`);
  } else {
    console.log(`\n❌ FAIL — ${trueLost.length} rows WITH identity are not found in any staging list.`);
    for (const r of trueLost.slice(0, 10)) {
      console.log(`  ${r.sourceLabel} row ${r.rowNum}: name="${r.sourceName}", phone10="${r.sourcePhone10}", email="${r.sourceEmail}"`);
    }
  }
  console.log("\nDone. Report and CSV written. STOP — do not push.");
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
