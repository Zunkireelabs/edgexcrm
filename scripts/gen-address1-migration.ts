/**
 * scripts/gen-address1-migration.ts
 *
 * Reads "6 - MODEL SECONDARY SCHOOL MANAGEMENT.xlsx", extracts rows that have
 * both a phone number and a non-empty Address_1, and writes
 * supabase/migrations/083_backfill_model_mgmt_address1.sql.
 *
 * Run once: npx tsx scripts/gen-address1-migration.ts
 * READ-ONLY against the workbook; the SQL file itself must be applied separately.
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const WORKBOOK_PATH = path.join(
  "temp_ss/cus-admizz-docs/migration-leads",
  "6 - MODEL SECONDARY SCHOOL MANAGEMENT.xlsx"
);
const OUT_PATH = "supabase/migrations/083_backfill_model_mgmt_address1.sql";

// ── Normalise phone to last-10 digits ────────────────────────────────────────
function phone10(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  // reject obvious placeholders
  if (/^(.)\1+$/.test(last10)) return null;
  if (last10 === "1234567890") return null;
  return last10;
}

// ── Normalise Address_1 value ────────────────────────────────────────────────
function cleanAddr(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "-" || s.toLowerCase() === "null") return null;
  return s;
}

// ── SQL escape single-quotes ─────────────────────────────────────────────────
function sqlStr(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

// ── Main ─────────────────────────────────────────────────────────────────────
const wb = XLSX.readFile(WORKBOOK_PATH);

// The management file has a single data sheet (first sheet)
const sheetName = wb.SheetNames[0];
console.log(`Sheet: "${sheetName}"`);
const ws = wb.Sheets[sheetName];

const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
console.log(`Total rows read: ${rows.length}`);

// Inspect headers to find phone and address columns
const headers = Object.keys(rows[0] || {});
console.log("Headers:", headers);

// Identify columns (normalised lowercase comparison)
const phoneCol   = headers.find(h => /contact\s*no/i.test(h)) || headers.find(h => /phone/i.test(h));
const addr1Col   = headers.find(h => /address_1/i.test(h))  || headers.find(h => /address_?1/i.test(h));

if (!phoneCol) { console.error("Cannot find phone column"); process.exit(1); }
if (!addr1Col) { console.error("Cannot find Address_1 column. Available:", headers); process.exit(1); }

console.log(`Phone column : "${phoneCol}"`);
console.log(`Address1 col : "${addr1Col}"`);

interface Pair { phone10: string; address_1: string }
const pairs: Pair[] = [];
let noAddr = 0, noEither = 0;

for (const row of rows) {
  const p = phone10(row[phoneCol]);
  const a = cleanAddr(row[addr1Col]);

  if (!p && !a) { noEither++; continue; }
  if (!p)       { noAddr++; continue; }   // has addr but no matchable phone
  if (!a)       { continue; }             // no address — skip silently

  pairs.push({ phone10: p, address_1: a });
}

console.log(`\nPairs with phone10 + Address_1: ${pairs.length}`);
console.log(`Rows missing phone (unmatchable): ${noAddr}`);
console.log(`Rows missing both (empty roster): ${noEither}`);

if (pairs.length === 0) {
  console.error("No pairs found — check column names above.");
  process.exit(1);
}

// ── Build VALUES list (de-dup by phone10; keep first occurrence) ──────────────
const seen = new Map<string, string>();
for (const { phone10: p, address_1: a } of pairs) {
  if (!seen.has(p)) seen.set(p, a);
}
console.log(`Unique phone10 keys: ${seen.size} (${pairs.length - seen.size} duplicates collapsed)`);

const valueLines = [...seen.entries()]
  .map(([p, a]) => `  (${sqlStr(p)},${sqlStr(a)})`)
  .join(",\n");

// ── Write SQL ────────────────────────────────────────────────────────────────
const sql = `-- 083_backfill_model_mgmt_address1.sql
-- Backfills custom_fields.address_1 for Admizz "Model Secondary School - Management"
-- leads. The Address_1 column (ward-level address, e.g. "BHRAMAPURA-7") was present
-- in the source workbook but not captured during the original import.
-- Additive only: only updates rows where address_1 is absent (idempotent).
-- Scope: stage DB (dymeudcddasqpomfpjvt) only; never run on prod until promoted.

BEGIN;

-- ── Before count ──────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE custom_fields ? 'address_1') AS before_has_address1,
  count(*)                                              AS total_mgmt
FROM leads
WHERE tenant_id    = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND intake_source = 'Model Secondary School - Management'
  AND deleted_at   IS NULL;

-- ── Source data (phone10 → Address_1) ────────────────────────────────────────
CREATE TEMP TABLE _addr1(phone10 TEXT, address_1 TEXT) ON COMMIT DROP;
INSERT INTO _addr1 VALUES
${valueLines};

-- ── Additive update ──────────────────────────────────────────────────────────
WITH upd AS (
  UPDATE leads l
  SET custom_fields = l.custom_fields || jsonb_build_object('address_1', a.address_1)
  FROM _addr1 a
  WHERE l.tenant_id    = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.intake_source = 'Model Secondary School - Management'
    AND l.deleted_at   IS NULL
    AND right(regexp_replace(l.phone, '\\D', '', 'g'), 10) = a.phone10
    AND NOT (l.custom_fields ? 'address_1')
  RETURNING l.id
)
SELECT count(*) AS rows_updated FROM upd;

-- ── After count ───────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE custom_fields ? 'address_1') AS after_has_address1,
  count(*)                                              AS total_mgmt
FROM leads
WHERE tenant_id    = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND intake_source = 'Model Secondary School - Management'
  AND deleted_at   IS NULL;

COMMIT;
`;

fs.writeFileSync(OUT_PATH, sql, "utf8");
console.log(`\nWritten: ${OUT_PATH}`);
console.log("Next step: apply via Supabase SQL editor (stage only), then commit the .sql file.");
