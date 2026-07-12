/**
 * Partner college country-suffix reconciliation (one-time, per-tenant)
 *
 * Real production data encodes destination country as a ", <Country>" suffix
 * baked into the college name itself (e.g. "Aalborg University, Denmark").
 * The country-filtered University picker feature added a separate `country`
 * column instead — this script migrates existing rows from the old
 * name-suffix convention to the new column, so the dropdown shows each
 * college once (bare name) instead of duplicating it alongside a
 * newly-created bare-named row.
 *
 * Deliberately does NOT touch scripts/backfill-partner-college-countries.ts's
 * 124-university seed list — that list is for environments with no existing
 * country-suffixed data (e.g. a fresh local DB). Running both against the
 * same tenant would double up every college that exists in both places.
 *
 * Only touches rows whose name matches exactly one ", <Country>" suffix and
 * whose country column is still NULL — anything already tagged, or with an
 * unexpected comma count, is left untouched and reported for manual review.
 *
 * This is real business data tied to a specific tenant (not schema), so it
 * lives here as a one-off script — not inside supabase/migrations/ (see
 * CLAUDE.md § Migrations: "one-time data ETL does NOT belong in a numbered
 * migration"). Run once per environment against the named tenant.
 *
 * Usage:
 *   # dry-run (default, NO writes) — prints exactly what would change
 *   npx tsx scripts/reconcile-partner-college-country-suffix.ts --tenant-slug admizz
 *
 *   # apply for real
 *   npx tsx scripts/reconcile-partner-college-country-suffix.ts --tenant-slug admizz --apply
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}
const APPLY = args.includes("--apply");
const TENANT_SLUG = flag("tenant-slug");

if (!TENANT_SLUG) {
  console.error("Usage: npx tsx scripts/reconcile-partner-college-country-suffix.ts --tenant-slug <slug> [--apply]");
  process.exit(1);
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`);

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("slug", TENANT_SLUG)
    .single();
  if (tenantErr || !tenant) {
    console.error(`Tenant not found for slug "${TENANT_SLUG}":`, tenantErr?.message);
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const { data: colleges, error: collegesErr } = await supabase
    .from("partner_colleges")
    .select("id, name, country")
    .eq("tenant_id", tenant.id)
    .is("country", null);
  if (collegesErr) {
    console.error("Failed to fetch partner colleges:", collegesErr.message);
    process.exit(1);
  }

  const toReconcile: { id: string; oldName: string; newName: string; country: string }[] = [];
  const skipped: string[] = [];

  for (const c of colleges ?? []) {
    const parts = c.name.split(",");
    if (parts.length !== 2) {
      skipped.push(c.name);
      continue;
    }
    const newName = parts[0].trim();
    const country = parts[1].trim();
    if (!newName || !country) {
      skipped.push(c.name);
      continue;
    }
    toReconcile.push({ id: c.id, oldName: c.name, newName, country });
  }

  console.log(`\n== Colleges to reconcile (${toReconcile.length}) ==`);
  for (const r of toReconcile) {
    console.log(`  "${r.oldName}" -> name: "${r.newName}", country: "${r.country}"`);
  }

  if (skipped.length > 0) {
    console.log(`\n== Skipped, needs manual review (${skipped.length}) ==`);
    for (const name of skipped) console.log(`  ? ${name}`);
  }

  const neededCountries = [...new Set(toReconcile.map((r) => r.country))].sort();
  const { data: existingCountries, error: countriesErr } = await supabase
    .from("countries")
    .select("name")
    .eq("tenant_id", tenant.id);
  if (countriesErr) {
    console.error("Failed to fetch countries:", countriesErr.message);
    process.exit(1);
  }
  const existingSet = new Set((existingCountries ?? []).map((c) => c.name));
  const countriesToAdd = neededCountries.filter((c) => !existingSet.has(c));

  console.log(`\n== Countries to add (${countriesToAdd.length}) ==`);
  for (const c of countriesToAdd) console.log(`  + ${c}`);

  if (!APPLY) {
    console.log("\nDry run only — nothing written. Re-run with --apply to write these changes.");
    return;
  }

  if (countriesToAdd.length > 0) {
    const { error } = await supabase
      .from("countries")
      .insert(countriesToAdd.map((name) => ({ tenant_id: tenant.id, name, is_active: true })));
    if (error) {
      console.error("Failed to insert countries:", error.message);
      process.exit(1);
    }
    console.log(`Inserted ${countriesToAdd.length} countries.`);
  }

  let updated = 0;
  for (const r of toReconcile) {
    const { error } = await supabase
      .from("partner_colleges")
      .update({ name: r.newName, country: r.country })
      .eq("id", r.id);
    if (error) {
      console.error(`Failed to update "${r.oldName}":`, error.message);
      continue;
    }
    updated++;
  }
  console.log(`\nReconciled ${updated}/${toReconcile.length} colleges.`);
}

main();
