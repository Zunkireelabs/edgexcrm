/**
 * Seed a local-only "Lead Triage" agent identity for Phase 5 slice 5.1b
 * end-to-end verification (docs/ai-native-efforts/03-PHASE-3-BACKGROUND-AGENTS.md).
 *
 * Creates (idempotently, safe to re-run):
 *   1. A broad-read "AI Agent — Lead Triage" position (member-tier, leadScope:"all",
 *      no write grants) for the target tenant.
 *   2. An active agent_identities row (agent_key:'lead-triage') on that position.
 *   3. Flips the target tenant's ai_enabled + ai_agents_enabled to true.
 *
 * Agents are hired per-tenant (the real UI for this lands in slice 5.2's
 * /orca/agents catalog) — this script is a LOCAL test-only stand-in for that
 * UI, never a migration, and never run against stage/prod.
 *
 * Usage:
 *   npx tsx scripts/seed-agent-local.ts                    # defaults to test-agency
 *   npx tsx scripts/seed-agent-local.ts --tenant-slug=admizz-local
 *
 * LOCAL DB ONLY. Refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at
 * 127.0.0.1/localhost.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const tenantSlugArg = process.argv.find((a) => a.startsWith("--tenant-slug="));
const TENANT_SLUG = tenantSlugArg ? tenantSlugArg.split("=")[1] : "test-agency";

const AGENT_KEY = "lead-triage";
const POSITION_SLUG = "ai-agent-lead-triage";
const POSITION_NAME = "AI Agent — Lead Triage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error(`Refusing to run — NEXT_PUBLIC_SUPABASE_URL ("${SUPABASE_URL}") does not look like the local stack. This script is local-only.`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const POSITION_PERMISSIONS = {
  nav: { mode: "all" as const },
  pipelines: { mode: "all" as const },
  lists: { mode: "all" as const },
  leadScope: "all" as const,
  canAssignLeads: false,
  canEditLeads: false,
  canManageApplications: false,
  canManageClasses: false,
  canManageHR: false,
  canExport: false,
  dashboard: { widgets: { mode: "all" as const } },
};

async function main() {
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, ai_enabled, ai_agents_enabled")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (tenantError || !tenant) {
    console.error(`Tenant "${TENANT_SLUG}" not found:`, tenantError?.message ?? "no row");
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .upsert(
      {
        tenant_id: tenant.id,
        name: POSITION_NAME,
        slug: POSITION_SLUG,
        base_tier: "member",
        is_system: false,
        permissions: POSITION_PERMISSIONS,
      },
      { onConflict: "tenant_id,slug" },
    )
    .select("id")
    .single();
  if (positionError || !position) {
    console.error("Failed to upsert position:", positionError?.message);
    process.exit(1);
  }
  console.log(`Position: ${POSITION_NAME} (${position.id})`);

  const { data: identity, error: identityError } = await supabase
    .from("agent_identities")
    .upsert(
      {
        tenant_id: tenant.id,
        agent_key: AGENT_KEY,
        display_name: "Lead Triage",
        position_id: position.id,
        status: "active",
      },
      { onConflict: "tenant_id,agent_key" },
    )
    .select("id")
    .single();
  if (identityError || !identity) {
    console.error("Failed to upsert agent_identities row:", identityError?.message);
    process.exit(1);
  }
  console.log(`Agent identity: ${AGENT_KEY} (${identity.id}), status active`);

  const { error: tenantUpdateError } = await supabase
    .from("tenants")
    .update({ ai_enabled: true, ai_agents_enabled: true })
    .eq("id", tenant.id);
  if (tenantUpdateError) {
    console.error("Failed to enable ai_enabled/ai_agents_enabled on tenant:", tenantUpdateError.message);
    process.exit(1);
  }
  console.log(`Tenant flags: ai_enabled=true, ai_agents_enabled=true`);

  console.log("\nDone. Set AI_AGENTS_ENABLED=true in .env.local, start the Inngest dev server, then create a lead in this tenant.");
}

main();
