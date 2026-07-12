/**
 * Partner college country backfill (one-time, per-tenant)
 *
 * Tags every partner college with its destination country, and creates any
 * missing colleges from Admizz's real university list. Also ensures every
 * country referenced by that list exists in the tenant's Destination
 * Countries settings (adding any that are missing).
 *
 * This is real business data tied to a specific tenant (not schema), so it
 * lives here as a one-off script — not inside supabase/migrations/ (see
 * CLAUDE.md § Migrations: "one-time data ETL does NOT belong in a numbered
 * migration"). Run once per environment against the named tenant.
 *
 * Usage:
 *   # dry-run (default, NO writes) — prints exactly what would change
 *   npx tsx scripts/backfill-partner-college-countries.ts --tenant-slug admizz-local
 *
 *   # apply for real
 *   npx tsx scripts/backfill-partner-college-countries.ts --tenant-slug admizz-local --apply
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
  console.error("Usage: npx tsx scripts/backfill-partner-college-countries.ts --tenant-slug <slug> [--apply]");
  process.exit(1);
}

// Source: pasted client list (Australia, Canada, UAE, France, Denmark, Finland,
// New Zealand, India, Germany) + admizzeducation.com/study-in-the-usa and
// /study-in-the-uk (verified 2026-07-10 — the UK page's "Oxford, Cambridge,
// Manchester, Bristol, Leeds, Birmingham" line is generic marketing copy under
// "World-Renowned Universities", not a partner listing, and is excluded).
const COUNTRY_UNIVERSITIES: Record<string, string[]> = {
  Australia: [
    "Western Sydney University", "La Trobe University", "Victoria University",
    "University of Queensland", "Monash University", "Kaplan Business School",
    "Southern Cross University", "RMIT University", "Macquarie University",
    "University of Tasmania",
  ],
  Canada: [
    "University of Toronto", "University of British Columbia", "McGill University",
    "University of Alberta", "McMaster University", "University of Waterloo",
    "Western University", "Queen's University", "Simon Fraser University",
    "Dalhousie University",
  ],
  UAE: [
    "United Arab Emirates University", "Khalifa University", "American University of Sharjah",
    "Zayed University", "University of Sharjah", "American University in Dubai",
    "University of Wollongong in Dubai", "Heriot-Watt University Dubai",
    "Canadian University Dubai", "Middlesex University Dubai",
  ],
  France: [
    "Sorbonne University", "Universite PSL", "Universite Grenoble Alpes",
    "Aix-Marseille University", "Universite de Strasbourg", "Universite de Bordeaux",
    "Sciences Po", "Ecole Polytechnique", "Universite de Lille",
    "University of Paris-Saclay",
  ],
  Denmark: [
    "University of Copenhagen", "Aarhus University", "Technical University of Denmark",
    "University of Southern Denmark", "Aalborg University", "Copenhagen Business School",
    "Roskilde University", "IT University of Copenhagen", "VIA University College",
    "University College Copenhagen",
  ],
  Finland: [
    "Haaga-Helia University of Applied Science", "South-Eastern Finland University of Applied Science",
    "Lab University of Applied Science", "Satakunta University of Applied Science",
    "Vaasa University of Applied Science", "Karelia University of Applied Science",
  ],
  "New Zealand": [
    "University of Auckland", "University of Otago", "Victoria University of Wellington",
    "University of Canterbury", "Massey University", "Auckland University of Technology",
    "Lincoln University", "Unitec Institute of Technology", "Eastern Institute of Technology",
    "Southern Institute of Technology",
  ],
  India: [
    "Vellore Institute of Technology (VIT)", "University of Delhi", "Jawaharlal Nehru University",
    "Banaras Hindu University", "Anna University", "Manipal Academy of Higher Education",
    "Kalinga Institute of Technology", "RK University", "IISc Bangalore",
    "Delhi Technological University (DTU)", "Symbiosis International University",
  ],
  Germany: [
    "Technical University of Munich", "Ludwig-Maximilians-Universität München", "Heidelberg University",
    "Freie Universität Berlin", "Karlsruhe Institute of Technology", "RWTH Aachen University",
    "Technische Universität Berlin", "University of Hamburg", "University of Freiburg",
    "Humboldt-Universität zu Berlin",
  ],
  "United Kingdom": [
    "University of Roehampton", "BPP University", "University of Greenwich",
    "Buckinghamshire New University", "Coventry University", "Ulster University",
    "Health Sciences University", "Ravensbourne University London", "University of Sunderland",
    "University of East London", "The University of Law", "University of Worcester",
    "University of West London", "University of the West of Scotland", "York St John University",
  ],
  "United States of America": [
    "Colorado State University", "Webster University", "Avila University",
    "Concordia University", "Southeast Missouri State", "Herzing University",
    "Wright State University", "Washington University", "Texas State University",
    "Murray State University", "Youngstown State University", "University of Central Arkansas",
    "Dakota State University", "University of South Dakota", "Pacific Oaks College",
    "Bethesda University", "St. Cloud State University", "South Dakota State University",
    "Post University", "Northwest Missouri State", "University of Central Missouri",
    "Minnesota State University",
  ],
};

// Pre-existing seed/demo colleges that predate the real 124-university list
// above and never got a country tag. Left untagged, they show up under every
// country (the safety-net rule), which reads as a mismatch to a real admin
// (e.g. "University of Sydney" appearing while filtering by India). Tagging
// them here closes that gap for good instead of leaning on the safety net.
const LEGACY_COLLEGE_COUNTRY_FIXES: Record<string, string> = {
  "New York University": "United States of America",
  "University of London": "United Kingdom",
  "University of Manchester": "United Kingdom",
  "University of Melbourne": "Australia",
  "University of Sydney": "Australia",
};

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", TENANT_SLUG)
    .single();
  if (tenantErr || !tenant) {
    console.error(`Tenant not found for slug "${TENANT_SLUG}"`, tenantErr);
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const { data: existingCountries } = await supabase
    .from("countries")
    .select("id, name")
    .eq("tenant_id", tenant.id);
  const existingCountryNames = new Set((existingCountries ?? []).map((c) => c.name));

  const { data: existingColleges } = await supabase
    .from("partner_colleges")
    .select("id, name, country")
    .eq("tenant_id", tenant.id);
  const existingByName = new Map((existingColleges ?? []).map((c) => [c.name, c]));

  const countriesToAdd = Object.keys(COUNTRY_UNIVERSITIES).filter((c) => !existingCountryNames.has(c));
  const toUpdate: { id: string; name: string; from: string | null; to: string }[] = [];
  const toInsert: { name: string; country: string }[] = [];

  for (const [country, unis] of Object.entries(COUNTRY_UNIVERSITIES)) {
    for (const name of unis) {
      const existing = existingByName.get(name);
      if (existing) {
        if (existing.country !== country) {
          toUpdate.push({ id: existing.id, name, from: existing.country, to: country });
        }
      } else {
        toInsert.push({ name, country });
      }
    }
  }

  for (const [name, country] of Object.entries(LEGACY_COLLEGE_COUNTRY_FIXES)) {
    const existing = existingByName.get(name);
    if (existing && existing.country !== country) {
      toUpdate.push({ id: existing.id, name, from: existing.country, to: country });
    }
  }

  console.log(`\n== Countries to add (${countriesToAdd.length}) ==`);
  countriesToAdd.forEach((c) => console.log(`  + ${c}`));

  console.log(`\n== Colleges to tag/retag (${toUpdate.length}) ==`);
  toUpdate.forEach((u) => console.log(`  ~ ${u.name}: ${u.from ?? "(none)"} -> ${u.to}`));

  console.log(`\n== Colleges to create (${toInsert.length}) ==`);
  toInsert.forEach((i) => console.log(`  + ${i.name} (${i.country})`));

  if (!APPLY) {
    console.log("\nDry run only — nothing written. Re-run with --apply to write these changes.");
    return;
  }

  for (const country of countriesToAdd) {
    const { error } = await supabase.from("countries").insert({
      tenant_id: tenant.id,
      name: country,
      description: `Study destinations in ${country}`,
    });
    if (error) console.error(`Failed to add country ${country}:`, error.message);
  }

  for (const u of toUpdate) {
    const { error } = await supabase.from("partner_colleges").update({ country: u.to }).eq("id", u.id);
    if (error) console.error(`Failed to tag ${u.name}:`, error.message);
  }

  for (const i of toInsert) {
    const { error } = await supabase.from("partner_colleges").insert({
      tenant_id: tenant.id,
      name: i.name,
      country: i.country,
      is_active: true,
    });
    if (error) console.error(`Failed to create ${i.name}:`, error.message);
  }

  console.log("\nDone.");
}

main();
