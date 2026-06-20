/**
 * Tenant onboarding CLI
 *
 * Creates a brand-new tenant end-to-end against the Supabase project configured
 * in .env.local. One tenant = one industry (see CLAUDE.md). A complete tenant is:
 *
 *   1. tenants            row (name, slug, industry_id)
 *   2. Supabase auth user (owner login, email auto-confirmed)
 *   3. tenant_users       row linking the user as role 'owner'
 *   4. pipelines          one default pipeline ("Default")
 *   5. pipeline_stages    seeded from the industry's default_pipeline_stages
 *   6. lead_lists         4 system lists (Pre-qualified/Qualified/Prospects/Archived)
 *                         — education_consultancy tenants only
 *
 * Usage:
 *   # dry-run (default, NO writes) — prints exactly what would be created
 *   npx tsx scripts/onboard-tenant.ts \
 *     --name "Prime Ceramics" --slug prime-ceramics --industry construction \
 *     --email info@primeceramics.com.np --password 'prime@123'
 *
 *   # apply for real (requires the review token)
 *   npx tsx scripts/onboard-tenant.ts \
 *     --name "Prime Ceramics" --slug prime-ceramics --industry construction \
 *     --email info@primeceramics.com.np --password 'prime@123' \
 *     --apply --yes-i-reviewed-the-dry-run
 *
 * Optional:
 *   --full-name "..."   owner display name (defaults to the tenant name)
 *
 * HARD RULES:
 *   - Dry-run is the default. --apply requires the explicit --yes-i-reviewed-the-dry-run token.
 *   - Aborts (no partial writes) if the slug is taken or the email already has an auth user.
 *   - On any failure mid-apply, best-effort rollback removes whatever was created.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

// ── config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

const NAME = flag("name");
const SLUG = flag("slug");
const INDUSTRY = flag("industry");
const EMAIL = flag("email")?.toLowerCase();
const PASSWORD = flag("password");
const FULL_NAME = flag("full-name") || NAME;

const APPLY = args.includes("--apply");
const REVIEWED = args.includes("--yes-i-reviewed-the-dry-run");

const missing = [
  ["--name", NAME],
  ["--slug", SLUG],
  ["--industry", INDUSTRY],
  ["--email", EMAIL],
  ["--password", PASSWORD],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error(`Missing required flags: ${missing.join(", ")}`);
  process.exit(1);
}

// slug sanity: lowercase letters, digits, hyphens
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(SLUG!)) {
  console.error(`Invalid slug "${SLUG}". Use lowercase letters, digits, and single hyphens (e.g. prime-ceramics).`);
  process.exit(1);
}

if (PASSWORD!.length < 8) {
  console.error("Password must be at least 8 characters (Supabase Auth minimum).");
  process.exit(1);
}

if (APPLY && !REVIEWED) {
  console.error(
    "\n⛔  SAFETY STOP\n" +
    "You requested --apply, which writes to the configured Supabase project.\n" +
    "  1. Run WITHOUT --apply first and review the dry-run plan.\n" +
    "  2. Re-run with --apply --yes-i-reviewed-the-dry-run to confirm.\n"
  );
  process.exit(1);
}

// ── industry stage typing ─────────────────────────────────────────────────────

interface IndustryStage {
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
}

// terminal_type is constrained to 'won' | 'lost' on pipeline_stages. The industry
// JSON only carries is_terminal, so derive the type: negative-outcome terminal
// stages → 'lost', everything else terminal → 'won'. (Healthcare's neutral
// "Discharged" lands on 'won'; harmless, revisit if healthcare onboards.)
const LOST_SLUGS = new Set(["lost", "rejected", "cancelled", "canceled", "closed-lost", "disqualified"]);
function terminalType(s: IndustryStage): "won" | "lost" | null {
  if (!s.is_terminal) return null;
  return LOST_SLUGS.has(s.slug) ? "lost" : "won";
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Industry must exist; pull its default pipeline stages.
  const { data: industry, error: indErr } = await supabase
    .from("industries")
    .select("id, name, default_pipeline_stages")
    .eq("id", INDUSTRY)
    .single();

  if (indErr || !industry) {
    console.error(`Industry "${INDUSTRY}" not found in the industries table. Run with a valid industry_id.`);
    process.exit(1);
  }

  const stages = ((industry.default_pipeline_stages as IndustryStage[]) || [])
    .slice()
    .sort((a, b) => a.position - b.position);

  // 2. Pre-flight uniqueness checks (abort before any write).
  const { data: existingTenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", SLUG)
    .maybeSingle();
  if (existingTenant) {
    console.error(`A tenant with slug "${SLUG}" already exists (id ${existingTenant.id}). Aborting.`);
    process.exit(1);
  }

  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("Failed to list auth users for pre-flight email check:", listErr.message);
    process.exit(1);
  }
  const emailTaken = userList.users.some((u) => u.email?.toLowerCase() === EMAIL);
  if (emailTaken) {
    console.error(`An auth user with email "${EMAIL}" already exists. Aborting.`);
    process.exit(1);
  }

  // ── plan printout ───────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(APPLY ? "APPLYING tenant onboarding" : "DRY-RUN — no writes will be made");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Tenant:    ${NAME}  (slug: ${SLUG})`);
  console.log(`Industry:  ${industry.id} — ${industry.name}`);
  console.log(`Owner:     ${EMAIL}  (full name: ${FULL_NAME}, role: owner)`);
  console.log(`Pipeline:  "Default" (slug: default, is_default: true)`);
  console.log(`Stages (${stages.length}):`);
  for (const s of stages) {
    const tt = terminalType(s);
    console.log(
      `   ${String(s.position).padStart(2)}  ${s.name.padEnd(24)} ${s.color}` +
      `${s.is_default ? "  [default]" : ""}${s.is_terminal ? `  [terminal:${tt}]` : ""}`
    );
  }
  if (industry.id === "education_consultancy") {
    console.log(`Lead lists (education_consultancy):`);
    console.log(`    1  Pre-qualified  [is_intake, is_system]`);
    console.log(`    2  Qualified      [is_system]`);
    console.log(`    3  Prospects      [is_system]`);
    console.log(`    4  Archived       [is_archive, is_system]`);
  }
  console.log("──────────────────────────────────────────────────────────────\n");

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply --yes-i-reviewed-the-dry-run to create.\n");
    return;
  }

  // ── apply (with best-effort rollback) ─────────────────────────────────────────
  let tenantId: string | undefined;
  let userId: string | undefined;

  try {
    // 1. tenant
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .insert({ name: NAME, slug: SLUG, industry_id: industry.id })
      .select("id")
      .single();
    if (tErr || !tenant) throw new Error(`tenants insert failed: ${tErr?.message}`);
    tenantId = tenant.id;
    console.log(`✓ tenant created: ${tenantId}`);

    // 2. auth user (owner)
    const { data: authData, error: aErr } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    });
    if (aErr || !authData.user) throw new Error(`auth user create failed: ${aErr?.message}`);
    userId = authData.user.id;
    console.log(`✓ auth user created: ${userId}`);

    // 3. tenant_users (owner link)
    const { error: muErr } = await supabase
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
    if (muErr) throw new Error(`tenant_users insert failed: ${muErr.message}`);
    console.log(`✓ owner membership created`);

    // 4. default pipeline
    const { data: pipeline, error: pErr } = await supabase
      .from("pipelines")
      .insert({ tenant_id: tenantId, name: "Default", slug: "default", is_default: true, position: 0 })
      .select("id")
      .single();
    if (pErr || !pipeline) throw new Error(`pipelines insert failed: ${pErr?.message}`);
    console.log(`✓ default pipeline created: ${pipeline.id}`);

    // 5. pipeline stages
    const stageRows = stages.map((s) => ({
      tenant_id: tenantId,
      pipeline_id: pipeline.id,
      name: s.name,
      slug: s.slug,
      position: s.position,
      color: s.color,
      is_default: s.is_default,
      is_terminal: s.is_terminal,
      terminal_type: terminalType(s),
    }));
    const { error: sErr } = await supabase.from("pipeline_stages").insert(stageRows);
    if (sErr) throw new Error(`pipeline_stages insert failed: ${sErr.message}`);
    console.log(`✓ ${stageRows.length} stages created`);

    // 6. lead_lists — education_consultancy only.
    // Mirrors supabase/migrations/059_lead_lists.sql seed values exactly.
    // NOTE: application_stages and positions also need seeding for education tenants
    // but are not provisioned here yet — tracked in 057_application_tracking.sql notes.
    if (industry.id === "education_consultancy") {
      const listRows = [
        { tenant_id: tenantId, name: "Pre-qualified", slug: "pre-qualified", sort_order: 1, is_system: true, is_intake: true,  is_archive: false, access: { mode: "all" } },
        { tenant_id: tenantId, name: "Qualified",     slug: "qualified",     sort_order: 2, is_system: true, is_intake: false, is_archive: false, access: { mode: "all" } },
        { tenant_id: tenantId, name: "Prospects",     slug: "prospects",     sort_order: 3, is_system: true, is_intake: false, is_archive: false, access: { mode: "all" } },
        { tenant_id: tenantId, name: "Archived",      slug: "archived",      sort_order: 4, is_system: true, is_intake: false, is_archive: true,  access: { mode: "all" } },
      ];
      const { error: lErr } = await supabase.from("lead_lists").insert(listRows);
      if (lErr) throw new Error(`lead_lists insert failed: ${lErr.message}`);
      console.log(`✓ 4 system lead lists created`);
    }

    console.log("\n✅ Onboarding complete.");
    console.log(`   Tenant:  ${NAME} (${tenantId})`);
    console.log(`   Login:   ${EMAIL}`);
    console.log(`   Sign in at the dashboard /login and verify the pipeline renders.\n`);
  } catch (err) {
    console.error(`\n✗ Apply failed: ${(err as Error).message}`);
    console.error("Rolling back...");
    // Deleting the tenant cascades to pipelines/stages/tenant_users (ON DELETE CASCADE).
    if (tenantId) {
      const { error } = await supabase.from("tenants").delete().eq("id", tenantId);
      console.error(error ? `  ✗ tenant rollback failed: ${error.message}` : "  ✓ tenant row removed (cascade)");
    }
    if (userId) {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      console.error(error ? `  ✗ auth user rollback failed: ${error.message}` : "  ✓ auth user removed");
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
