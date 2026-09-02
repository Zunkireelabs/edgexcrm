/**
 * Seed local-only background-agent identities for Phase 5 / Phase 7
 * end-to-end verification (docs/ai-native-efforts/03-PHASE-3-BACKGROUND-AGENTS.md).
 *
 * Creates (idempotently, safe to re-run) for the target tenant:
 *   1. A broad-read "AI Agent — <name>" position (member-tier, leadScope:"all",
 *      no write grants) per seeded agent.
 *   2. An active agent_identities row per seeded agent.
 *   3. Flips the target tenant's ai_enabled + ai_agents_enabled to true.
 *
 * Agents seeded:
 *   - lead-triage        — every tenant (universal, industry-aware)
 *   - follow-up-drafter  — education_consultancy tenants only (industry-scoped,
 *                          fires on crm/lead.assigned → draft_email in the
 *                          review queue). See
 *                          src/industries/education-consultancy/ai/agents/follow-up-drafter.ts
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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const tenantSlugArg = process.argv.find((a) => a.startsWith("--tenant-slug="));
const TENANT_SLUG = tenantSlugArg ? tenantSlugArg.split("=")[1] : "test-agency";

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

interface AgentSeed {
  agentKey: string;
  displayName: string;
  positionSlug: string;
  positionName: string;
  /** Restrict to tenants in one of these industry ids; undefined = all. */
  industries?: string[];
}

const AGENT_SEEDS: AgentSeed[] = [
  {
    agentKey: "lead-triage",
    displayName: "Lead Triage",
    positionSlug: "ai-agent-lead-triage",
    positionName: "AI Agent — Lead Triage",
  },
  {
    agentKey: "follow-up-drafter",
    displayName: "Follow-up Drafter",
    positionSlug: "ai-agent-follow-up-drafter",
    positionName: "AI Agent — Follow-up Drafter",
    industries: ["education_consultancy"],
  },
];

async function seedAgent(
  db: SupabaseClient,
  tenantId: string,
  seed: AgentSeed,
): Promise<void> {
  const { data: position, error: positionError } = await db
    .from("positions")
    .upsert(
      {
        tenant_id: tenantId,
        name: seed.positionName,
        slug: seed.positionSlug,
        base_tier: "member",
        is_system: false,
        permissions: POSITION_PERMISSIONS,
      },
      { onConflict: "tenant_id,slug" },
    )
    .select("id")
    .single();
  if (positionError || !position) {
    console.error(`Failed to upsert position for ${seed.agentKey}:`, positionError?.message);
    process.exit(1);
  }
  console.log(`Position: ${seed.positionName} (${position.id})`);

  const { data: identity, error: identityError } = await db
    .from("agent_identities")
    .upsert(
      {
        tenant_id: tenantId,
        agent_key: seed.agentKey,
        display_name: seed.displayName,
        position_id: position.id,
        status: "active",
      },
      { onConflict: "tenant_id,agent_key" },
    )
    .select("id")
    .single();
  if (identityError || !identity) {
    console.error(`Failed to upsert agent_identities row for ${seed.agentKey}:`, identityError?.message);
    process.exit(1);
  }
  console.log(`Agent identity: ${seed.agentKey} (${identity.id}), status active`);
}

async function main() {
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, industry_id, ai_enabled, ai_agents_enabled")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (tenantError || !tenant) {
    console.error(`Tenant "${TENANT_SLUG}" not found:`, tenantError?.message ?? "no row");
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id}), industry ${tenant.industry_id}`);

  for (const seed of AGENT_SEEDS) {
    if (seed.industries && !seed.industries.includes(tenant.industry_id as string)) {
      console.log(`Skipping ${seed.agentKey} — tenant industry (${tenant.industry_id}) not in [${seed.industries.join(", ")}]`);
      continue;
    }
    await seedAgent(supabase, tenant.id as string, seed);
  }

  const { error: tenantUpdateError } = await supabase
    .from("tenants")
    .update({ ai_enabled: true, ai_agents_enabled: true })
    .eq("id", tenant.id);
  if (tenantUpdateError) {
    console.error("Failed to enable ai_enabled/ai_agents_enabled on tenant:", tenantUpdateError.message);
    process.exit(1);
  }
  console.log(`Tenant flags: ai_enabled=true, ai_agents_enabled=true`);

  console.log("\nDone. Set AI_AGENTS_ENABLED=true in .env.local, start the Inngest dev server, then create/assign a lead in this tenant.");
}

main();
