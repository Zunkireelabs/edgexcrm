/**
 * One-time migration script: Old RKU leads → New multi-tenant CRM
 *
 * Usage:
 *   npx tsx scripts/migrate-rku-leads.ts           # Run migration
 *   npx tsx scripts/migrate-rku-leads.ts --dry-run  # Preview without inserting
 *
 * Requires in .env.local:
 *   SUPABASE_SERVICE_ROLE_KEY        (new CRM project)
 *   NEXT_PUBLIC_SUPABASE_URL         (new CRM project)
 *   OLD_SUPABASE_URL                 (old RKU project)
 *   OLD_SUPABASE_SERVICE_ROLE_KEY    (old RKU project)
 */

import { config } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

// --- Config ---
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 50;
const OLD_RKU_TENANT_SLUG = "rku";

const NEW_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const NEW_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OLD_SUPABASE_URL =
  process.env.OLD_SUPABASE_URL || "https://ldsgsdjixzsljgkcktqu.supabase.co";
const OLD_SERVICE_KEY = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY!;

// --- Validation ---
function validateEnv() {
  const missing: string[] = [];
  if (!NEW_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!NEW_SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!OLD_SERVICE_KEY) missing.push("OLD_SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(`Missing env vars in .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// --- Types ---
interface OldLead {
  id: string;
  session_id: string | null;
  step: number;
  is_final: boolean;
  status: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  course_level: string | null;
  course_name: string | null;
  agent_name: string | null;
  queries: string | null;
  citizenship_url: string | null;
  marks10_url: string | null;
  marks12_url: string | null;
  transcript_url: string | null;
  created_at: string;
  updated_at: string;
}

interface OldNote {
  id: string;
  lead_id: string;
  user_email: string;
  content: string;
  created_at: string;
}

interface NewLead {
  tenant_id: string;
  session_id: string | null;
  step: number;
  is_final: boolean;
  status: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  custom_fields: Record<string, unknown>;
  file_urls: Record<string, string>;
  created_at: string;
  updated_at: string;
}

// --- Transform ---
function transformLead(old: OldLead, tenantId: string): NewLead {
  const custom_fields: Record<string, unknown> = {};
  if (old.course_level) custom_fields.course_level = old.course_level;
  if (old.course_name) custom_fields.course_name = old.course_name;
  if (old.agent_name) custom_fields.agent_name = old.agent_name;
  if (old.queries) custom_fields.queries = old.queries;

  const file_urls: Record<string, string> = {};
  if (old.citizenship_url) file_urls.citizenship = old.citizenship_url;
  if (old.marks10_url) file_urls.marks10 = old.marks10_url;
  if (old.marks12_url) file_urls.marks12 = old.marks12_url;
  if (old.transcript_url) file_urls.transcript = old.transcript_url;

  return {
    tenant_id: tenantId,
    session_id: old.session_id,
    step: old.step,
    is_final: old.is_final,
    status: old.status,
    first_name: old.first_name,
    last_name: old.last_name,
    email: old.email,
    phone: old.phone,
    city: old.city,
    country: old.country,
    custom_fields,
    file_urls,
    created_at: old.created_at,
    updated_at: old.updated_at,
  };
}

// --- Main ---
async function main() {
  validateEnv();

  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE MIGRATION ===");
  console.log(`Old Supabase: ${OLD_SUPABASE_URL}`);
  console.log(`New Supabase: ${NEW_SUPABASE_URL}`);
  console.log("");

  const oldClient = createClient(OLD_SUPABASE_URL, OLD_SERVICE_KEY);
  const newClient = createClient(NEW_SUPABASE_URL, NEW_SERVICE_KEY);

  // 1. Look up RKU tenant ID in new DB
  const { data: tenant, error: tenantErr } = await newClient
    .from("tenants")
    .select("id, name")
    .eq("slug", OLD_RKU_TENANT_SLUG)
    .single();

  if (tenantErr || !tenant) {
    console.error(
      `Could not find tenant with slug '${OLD_RKU_TENANT_SLUG}' in new DB:`,
      tenantErr?.message
    );
    process.exit(1);
  }
  console.log(`Target tenant: ${tenant.name} (${tenant.id})`);

  // 2. Fetch all old leads
  const { data: oldLeads, error: fetchErr } = await oldClient
    .from("rku_leads")
    .select("*")
    .order("created_at", { ascending: true });

  if (fetchErr) {
    console.error("Failed to fetch old leads:", fetchErr.message);
    process.exit(1);
  }

  if (!oldLeads || oldLeads.length === 0) {
    console.log("No leads found in old database. Nothing to migrate.");
    return;
  }
  console.log(`Found ${oldLeads.length} leads in old database\n`);

  // 3. Fetch existing leads in new DB for dedup
  const { data: existingLeads } = await newClient
    .from("leads")
    .select("email, created_at")
    .eq("tenant_id", tenant.id);

  const existingSet = new Set(
    (existingLeads || []).map((l) => `${l.email}|${l.created_at}`)
  );

  // 4. Transform and filter
  const toInsert: NewLead[] = [];
  let skippedDupes = 0;

  for (const old of oldLeads as OldLead[]) {
    const dedupKey = `${old.email}|${old.created_at}`;
    if (existingSet.has(dedupKey)) {
      skippedDupes++;
      continue;
    }
    toInsert.push(transformLead(old, tenant.id));
  }

  console.log(`Leads to insert: ${toInsert.length}`);
  console.log(`Skipped (duplicates): ${skippedDupes}`);

  if (DRY_RUN) {
    console.log("\n--- Sample transforms (first 3) ---");
    for (const lead of toInsert.slice(0, 3)) {
      console.log(JSON.stringify(lead, null, 2));
    }
    console.log("\nDry run complete. No data was inserted.");
    return;
  }

  // 5. Batch insert
  let inserted = 0;
  let failed = 0;
  const oldIdToNewId = new Map<string, string>(); // for notes migration

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { data: insertedData, error: insertErr } = await newClient
      .from("leads")
      .insert(batch)
      .select("id, email, created_at");

    if (insertErr) {
      console.error(
        `Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`,
        insertErr.message
      );
      failed += batch.length;
    } else {
      inserted += (insertedData || []).length;
      // Map old lead IDs to new IDs via email+created_at
      for (const newLead of insertedData || []) {
        const matchKey = `${newLead.email}|${newLead.created_at}`;
        const oldLead = (oldLeads as OldLead[]).find(
          (o) => `${o.email}|${o.created_at}` === matchKey
        );
        if (oldLead) {
          oldIdToNewId.set(oldLead.id, newLead.id);
        }
      }
      process.stdout.write(
        `\rInserted: ${inserted}/${toInsert.length}  `
      );
    }
  }

  console.log(`\n\nLead migration complete: ${inserted} inserted, ${failed} failed`);

  // 6. Migrate notes
  await migrateNotes(oldClient, newClient, oldIdToNewId);

  console.log("\nAll done!");
}

async function migrateNotes(
  oldClient: SupabaseClient,
  newClient: SupabaseClient,
  oldIdToNewId: Map<string, string>
) {
  const { data: oldNotes, error: notesErr } = await oldClient
    .from("rku_lead_notes")
    .select("*")
    .order("created_at", { ascending: true });

  if (notesErr) {
    console.log("Could not fetch old notes (table may not exist):", notesErr.message);
    return;
  }

  if (!oldNotes || oldNotes.length === 0) {
    console.log("No notes to migrate.");
    return;
  }

  console.log(`\nMigrating ${oldNotes.length} notes...`);

  // Look up admin user in new DB
  const {
    data: { users },
  } = await newClient.auth.admin.listUsers();
  const adminUser = users?.find(
    (u) => u.email === "admin@zunkireelabs.com"
  );
  const fallbackUserId = adminUser?.id || "00000000-0000-0000-0000-000000000000";

  let notesInserted = 0;
  let notesSkipped = 0;

  for (const note of oldNotes as OldNote[]) {
    const newLeadId = oldIdToNewId.get(note.lead_id);
    if (!newLeadId) {
      notesSkipped++;
      continue;
    }

    // Find matching user by email, fallback to admin
    const matchedUser = users?.find((u) => u.email === note.user_email);

    const { error: insertErr } = await newClient.from("lead_notes").insert({
      lead_id: newLeadId,
      user_id: matchedUser?.id || fallbackUserId,
      user_email: note.user_email,
      content: note.content,
      created_at: note.created_at,
    });

    if (insertErr) {
      console.error(`Failed to insert note for lead ${newLeadId}:`, insertErr.message);
    } else {
      notesInserted++;
    }
  }

  console.log(`Notes migration: ${notesInserted} inserted, ${notesSkipped} skipped (no matching lead)`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
