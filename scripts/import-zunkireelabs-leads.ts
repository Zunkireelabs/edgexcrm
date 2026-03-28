/**
 * Import Zunkiree Labs leads from Excel files
 *
 * Usage:
 *   npx tsx scripts/import-zunkireelabs-leads.ts --dry-run   # Preview without inserting
 *   npx tsx scripts/import-zunkireelabs-leads.ts             # Run live import
 *
 * Data sources:
 *   - docs/zunkireelabs-data/leads/FCAN_Members.xlsx
 *   - docs/zunkireelabs-data/leads/Marketing.xls
 *   - docs/zunkireelabs-data/leads/Members list.xlsx
 *   - docs/zunkireelabs-data/leads/Updated Coprorate and TA Database 2021.xlsx
 *
 * IMPORTANT: This script ONLY imports to Zunkiree Labs tenant.
 * Other tenants are NOT affected.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as path from "path";

config({ path: ".env.local" });

// --- HARD-CODED TENANT - ZUNKIREE LABS ONLY ---
const ZUNKIREELABS_TENANT_ID = "a0000000-0000-0000-0000-000000000001";
const NEW_STAGE_ID = "5830d394-666f-4904-80a7-3fc648aeadfd"; // "New" stage

// --- Config ---
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 50;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const DATA_DIR = "docs/zunkireelabs-data/leads";

// --- Types ---
interface RawLead {
  source_file: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string;
  custom_fields: Record<string, unknown>;
}

interface CRMLead {
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  custom_fields: Record<string, unknown>;
  stage_id: string;
  status: string;
  is_final: boolean;
  intake_source: string;
}

// --- Helpers ---
function cleanString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str.length > 0 ? str : null;
}

function cleanEmail(val: unknown): string | null {
  const email = cleanString(val);
  if (!email) return null;
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Handle multiple emails (take first)
  const firstEmail = email.split(/[,;]/)[0].trim();
  return emailRegex.test(firstEmail) ? firstEmail.toLowerCase() : null;
}

function cleanPhone(val: unknown): string | null {
  const phone = cleanString(val);
  if (!phone) return null;
  // Take first phone if multiple, remove non-digits except +
  const firstPhone = phone.split(/[,/]/)[0].trim();
  // Keep digits and + only
  const cleaned = firstPhone.replace(/[^\d+]/g, "");
  return cleaned.length >= 7 ? cleaned : null;
}

function splitName(fullName: string | null): { first: string | null; last: string | null } {
  if (!fullName) return { first: null, last: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { first: parts[0], last: null };
  }
  return {
    first: parts[0],
    last: parts.slice(1).join(" "),
  };
}

// --- File Parsers ---
function parseFCANMembers(): RawLead[] {
  const filePath = path.join(DATA_DIR, "FCAN_Members.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

  return data.map((row) => {
    const name = splitName(cleanString(row["Contact Person"]));
    return {
      source_file: "FCAN_Members.xlsx",
      first_name: name.first,
      last_name: name.last,
      email: cleanEmail(row["Email"]),
      phone: cleanPhone(row["Mobile"]) || cleanPhone(row["Phone"]),
      city: cleanString(row["City/District"]),
      country: "Nepal",
      custom_fields: {
        company: cleanString(row["Company Name"]),
        designation: cleanString(row["Designation"]),
        address: cleanString(row["Address"]),
        membership_no: cleanString(row["Membership No."]),
        membership_class: cleanString(row["Class"]),
        fax: cleanString(row["Fax"]),
        po_box: cleanString(row["PO Box"]),
        office_phone: cleanPhone(row["Phone"]),
      },
    };
  });
}

function parseMarketing(): RawLead[] {
  const filePath = path.join(DATA_DIR, "Marketing.xls");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

  return data
    .filter((row) => cleanString(row["Name"]) || cleanString(row["E-mail"]))
    .map((row) => {
      const name = splitName(cleanString(row["Name"]));
      const phone = cleanPhone(row["Mobile"]);
      // Check if international (phone starts with country code other than 98/97)
      const isInternational = phone && !phone.startsWith("98") && !phone.startsWith("97") && phone.length > 10;

      return {
        source_file: "Marketing.xls",
        first_name: name.first,
        last_name: name.last,
        email: cleanEmail(row["E-mail"]),
        phone: phone,
        city: null,
        country: isInternational ? "International" : "Nepal",
        custom_fields: {
          company: cleanString(row["Organisation"]),
          designation: cleanString(row["Designation"]),
        },
      };
    });
}

function parseCorporateDatabase(): RawLead[] {
  const filePath = path.join(DATA_DIR, "Updated Coprorate and TA Database 2021.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // Skip header row (row 1 has column names)
  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 }) as Record<string, unknown>[];

  return data
    .filter((row) => {
      const company = cleanString(row["Name of Company"]);
      return company && company !== "Name of Company"; // Skip header-like rows
    })
    .map((row) => {
      const name = splitName(cleanString(row["Contact person"]));
      return {
        source_file: "Updated Coprorate and TA Database 2021.xlsx",
        first_name: name.first,
        last_name: name.last,
        email: cleanEmail(row["Email"]),
        phone: cleanPhone(row["Mobile no"]),
        city: cleanString(row["Address"]),
        country: "Nepal",
        custom_fields: {
          company: cleanString(row["Name of Company"]),
          designation: cleanString(row["Designation"]),
          address: cleanString(row["Address"]),
        },
      };
    });
}

function parseMembersList(): RawLead[] {
  const filePath = path.join(DATA_DIR, "Members list.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  const leads: RawLead[] = [];

  // Data starts at row 5 (index 4), columns are: S.N, Name, Phone, Email
  for (let i = 4; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 2) continue;

    const nameVal = cleanString(row[1]);
    if (!nameVal || nameVal === "Name") continue;

    const name = splitName(nameVal);
    leads.push({
      source_file: "Members list.xlsx",
      first_name: name.first,
      last_name: name.last,
      email: cleanEmail(row[3]),
      phone: cleanPhone(row[2]),
      city: null,
      country: "Nepal",
      custom_fields: {},
    });
  }

  return leads;
}

// --- Deduplication ---
function deduplicateLeads(leads: RawLead[]): RawLead[] {
  const seen = new Map<string, RawLead>();

  for (const lead of leads) {
    // Create dedup key: prefer email, fallback to phone
    let key: string | null = null;

    if (lead.email) {
      key = `email:${lead.email.toLowerCase()}`;
    } else if (lead.phone) {
      key = `phone:${lead.phone}`;
    } else {
      // No email or phone - use name as last resort
      const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").toLowerCase();
      if (fullName) {
        key = `name:${fullName}`;
      }
    }

    if (key && !seen.has(key)) {
      seen.set(key, lead);
    }
  }

  return Array.from(seen.values());
}

// --- Transform to CRM format ---
function toCRMLead(raw: RawLead): CRMLead {
  // Clean custom_fields - remove null/undefined values
  const cleanedCustomFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw.custom_fields)) {
    if (value !== null && value !== undefined) {
      cleanedCustomFields[key] = value;
    }
  }

  return {
    tenant_id: ZUNKIREELABS_TENANT_ID,
    first_name: raw.first_name,
    last_name: raw.last_name,
    email: raw.email,
    phone: raw.phone,
    city: raw.city,
    country: raw.country,
    custom_fields: cleanedCustomFields,
    stage_id: NEW_STAGE_ID,
    status: "new",
    is_final: true,
    intake_source: raw.source_file,
  };
}

// --- Main ---
async function main() {
  console.log("=".repeat(60));
  console.log("ZUNKIREE LABS LEAD IMPORT");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no data will be inserted)" : "LIVE IMPORT"}`);
  console.log(`Target Tenant ID: ${ZUNKIREELABS_TENANT_ID}`);
  console.log("");

  // Validate env
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verify tenant exists
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("id", ZUNKIREELABS_TENANT_ID)
    .single();

  if (tenantErr || !tenant) {
    console.error("Could not find Zunkiree Labs tenant:", tenantErr?.message);
    process.exit(1);
  }

  console.log(`Confirmed tenant: ${tenant.name} (${tenant.slug})`);
  console.log("");

  // Parse all files
  console.log("Parsing Excel files...");
  const allLeads: RawLead[] = [];

  try {
    const fcan = parseFCANMembers();
    console.log(`  FCAN_Members.xlsx: ${fcan.length} records`);
    allLeads.push(...fcan);
  } catch (e) {
    console.error("  Error parsing FCAN_Members.xlsx:", e);
  }

  try {
    const marketing = parseMarketing();
    console.log(`  Marketing.xls: ${marketing.length} records`);
    allLeads.push(...marketing);
  } catch (e) {
    console.error("  Error parsing Marketing.xls:", e);
  }

  try {
    const corporate = parseCorporateDatabase();
    console.log(`  Corporate Database: ${corporate.length} records`);
    allLeads.push(...corporate);
  } catch (e) {
    console.error("  Error parsing Corporate Database:", e);
  }

  try {
    const members = parseMembersList();
    console.log(`  Members list.xlsx: ${members.length} records`);
    allLeads.push(...members);
  } catch (e) {
    console.error("  Error parsing Members list.xlsx:", e);
  }

  console.log(`\nTotal raw records: ${allLeads.length}`);

  // Deduplicate
  const uniqueLeads = deduplicateLeads(allLeads);
  console.log(`After deduplication: ${uniqueLeads.length}`);

  // Check for existing leads in CRM
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("email, phone")
    .eq("tenant_id", ZUNKIREELABS_TENANT_ID);

  const existingEmails = new Set((existingLeads || []).map((l) => l.email?.toLowerCase()).filter(Boolean));
  const existingPhones = new Set((existingLeads || []).map((l) => l.phone).filter(Boolean));

  // Filter out already existing
  const newLeads = uniqueLeads.filter((lead) => {
    if (lead.email && existingEmails.has(lead.email.toLowerCase())) return false;
    if (lead.phone && existingPhones.has(lead.phone)) return false;
    return true;
  });

  console.log(`Already in CRM: ${uniqueLeads.length - newLeads.length}`);
  console.log(`New leads to import: ${newLeads.length}`);

  // Stats by source
  const bySource: Record<string, number> = {};
  for (const lead of newLeads) {
    bySource[lead.source_file] = (bySource[lead.source_file] || 0) + 1;
  }
  console.log("\nBreakdown by source:");
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}: ${count}`);
  }

  // Data quality stats
  const withEmail = newLeads.filter((l) => l.email).length;
  const withPhone = newLeads.filter((l) => l.phone).length;
  const withBoth = newLeads.filter((l) => l.email && l.phone).length;
  const withNeither = newLeads.filter((l) => !l.email && !l.phone).length;

  console.log("\nData quality:");
  console.log(`  With email: ${withEmail} (${((withEmail / newLeads.length) * 100).toFixed(1)}%)`);
  console.log(`  With phone: ${withPhone} (${((withPhone / newLeads.length) * 100).toFixed(1)}%)`);
  console.log(`  With both: ${withBoth}`);
  console.log(`  With neither: ${withNeither}`);

  if (DRY_RUN) {
    console.log("\n--- Sample leads (first 5) ---");
    const crmLeads = newLeads.slice(0, 5).map(toCRMLead);
    for (const lead of crmLeads) {
      console.log(JSON.stringify(lead, null, 2));
    }
    console.log("\n✓ Dry run complete. No data was inserted.");
    console.log(`  Run without --dry-run to import ${newLeads.length} leads.`);
    return;
  }

  // Live import
  console.log("\n" + "=".repeat(60));
  console.log("INSERTING LEADS...");
  console.log("=".repeat(60));

  const crmLeads = newLeads.map(toCRMLead);
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < crmLeads.length; i += BATCH_SIZE) {
    const batch = crmLeads.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.from("leads").insert(batch).select("id");

    if (error) {
      console.error(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      errors.push(error.message);
      failed += batch.length;
    } else {
      inserted += (data || []).length;
    }

    process.stdout.write(`\rProgress: ${Math.min(i + BATCH_SIZE, crmLeads.length)}/${crmLeads.length}`);
  }

  console.log("\n");
  console.log("=".repeat(60));
  console.log("IMPORT COMPLETE");
  console.log("=".repeat(60));
  console.log(`✓ Inserted: ${inserted}`);
  console.log(`✗ Failed: ${failed}`);

  if (errors.length > 0) {
    console.log("\nErrors encountered:");
    for (const err of errors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  }

  // Verify final count
  const { count } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", ZUNKIREELABS_TENANT_ID);

  console.log(`\nTotal leads in Zunkiree Labs tenant: ${count}`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
