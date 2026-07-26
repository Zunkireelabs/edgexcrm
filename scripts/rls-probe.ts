/**
 * RLS probe — proves cross-tenant isolation on `leads` holds under a REAL
 * authenticated session, not just in app code on the service-role client.
 *
 * The app enforces isolation primarily in application code (scopedClient +
 * explicit tenant_id filters) on the SERVICE-ROLE client, which bypasses RLS
 * entirely. RLS is the secondary defense guarding any path that talks to
 * Supabase with the anon key + a user's JWT (browser client, PostgREST,
 * future direct-client features). Per the RLS-testing SOP (see
 * docs/dev-collab/RLS-PROBE.md and DEV-WORKFLOW-AND-DEPLOYMENT.md), verifying
 * "RLS is fine" via service-role SQL/REST is a false-green trap — the
 * service role bypasses RLS, so a broken policy and an empty table look
 * identical. This script signs in as two real users and queries through the
 * anon-key + user-JWT client, which is the only path RLS actually applies to.
 *
 * Idempotent, safe to re-run: `npx tsx scripts/rls-probe.ts`
 * Teardown:                   `npx tsx scripts/rls-probe.ts --cleanup`
 *
 * LOCAL DB ONLY. Refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at
 * 127.0.0.1/localhost — this script provisions and deletes tenants/users/
 * leads and signs in as them; it must never touch stage or prod.
 *
 * NOT wired into `npm run test` / CI. CI-integration (a Docker-in-CI /
 * `supabase start` job to make this a required-blocking gate on stage/main)
 * is a deliberate tracked follow-up, not an oversight — see the runbook.
 */

import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const CLEANUP = process.argv.includes("--cleanup");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
  );
  process.exit(1);
}

// Hostname-exact, not substring: a substring test would happily accept a
// remote host that merely contains "localhost" somewhere in its URL. This
// script provisions AND DELETES tenants/users/leads, so the guard has to be
// the strict kind.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
let probeHostname: string;
try {
  probeHostname = new URL(SUPABASE_URL).hostname;
} catch {
  console.error(`Refusing to run — NEXT_PUBLIC_SUPABASE_URL ("${SUPABASE_URL}") is not a parseable URL.`);
  process.exit(1);
}
if (!LOCAL_HOSTS.has(probeHostname)) {
  console.error(
    `Refusing to run — NEXT_PUBLIC_SUPABASE_URL host ("${probeHostname}") is not the local stack. ` +
      `This script provisions + deletes data and signs in as fixture users; it is local-only.`,
  );
  process.exit(1);
}

const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);

const MARKER_KEY = "rls-probe-marker";
const PASSWORD = "rls-probe-pw-do-not-use-elsewhere-123!";

type Tenant = { slug: string; name: string; email: string };

const TENANTS: Record<"A" | "B", Tenant> = {
  A: { slug: "rls-probe-a", name: "RLS Probe A", email: "rls-probe-a@edgex.local" },
  B: { slug: "rls-probe-b", name: "RLS Probe B", email: "rls-probe-b@edgex.local" },
};

type Fixture = {
  tenantId: string;
  userId: string;
  pipelineId: string;
  leadId: string;
  accessToken: string;
};

let passCount = 0;
let failCount = 0;

function report(label: string, ok: boolean, detail?: string) {
  const line = `${ok ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`;
  console.log(line);
  if (ok) passCount++;
  else failCount++;
}

function decodeJwtRole(accessToken: string): string {
  const payload = accessToken.split(".")[1];
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return (JSON.parse(json) as { role?: string }).role ?? "<unknown>";
}

async function upsertTenant(t: Tenant): Promise<string> {
  const { data, error } = await serviceClient
    .from("tenants")
    .upsert({ slug: t.slug, name: t.name }, { onConflict: "slug" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`upsert tenant ${t.slug}: ${error?.message}`);
  return data.id as string;
}

async function upsertUser(email: string): Promise<string> {
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (!createError && created.user) return created.user.id;

  // Idempotent path: user already exists from a prior run. Sign in as anon
  // to recover their id rather than paging through admin.listUsers().
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !signIn.user) {
    throw new Error(`create/recover user ${email}: create=${createError?.message} signIn=${signInError?.message}`);
  }
  return signIn.user.id;
}

async function linkTenantUser(tenantId: string, userId: string) {
  const { error } = await serviceClient
    .from("tenant_users")
    .upsert({ tenant_id: tenantId, user_id: userId, role: "owner" }, { onConflict: "tenant_id,user_id" });
  if (error) throw new Error(`link tenant_user: ${error.message}`);
}

// NOT an upsert. `pipelines` has a BEFORE INSERT trigger
// (trigger_ensure_single_default_pipeline) that, when the incoming row has
// is_default = true, UPDATEs the tenant's other default pipeline rows to
// false. On an INSERT ... ON CONFLICT DO UPDATE that trigger updates the very
// row the ON CONFLICT clause then tries to update, and Postgres aborts with
// "ON CONFLICT DO UPDATE command cannot affect row a second time" — so an
// upsert here fails on every re-run against an existing fixture, which is
// precisely the idempotency this script advertises. Select-then-insert
// sidesteps the trigger/ON CONFLICT interaction entirely.
async function upsertPipeline(tenantId: string): Promise<string> {
  const { data: existing, error: selectError } = await serviceClient
    .from("pipelines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", "rls-probe")
    .maybeSingle();
  if (selectError) throw new Error(`select pipeline: ${selectError.message}`);
  if (existing) return existing.id as string;

  const { data, error } = await serviceClient
    .from("pipelines")
    .insert({ tenant_id: tenantId, name: "RLS Probe Pipeline", slug: "rls-probe", is_default: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert pipeline: ${error?.message}`);
  return data.id as string;
}

async function upsertMarkerLead(tenantId: string, pipelineId: string, name: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("leads")
    .upsert(
      {
        tenant_id: tenantId,
        pipeline_id: pipelineId,
        idempotency_key: MARKER_KEY,
        first_name: name,
        status: "new",
      },
      { onConflict: "tenant_id,idempotency_key" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`upsert marker lead: ${error?.message}`);
  return data.id as string;
}

async function signIn(email: string): Promise<string> {
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
  return data.session.access_token;
}

function userClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function setup(): Promise<Record<"A" | "B", Fixture>> {
  const out = {} as Record<"A" | "B", Fixture>;
  for (const key of ["A", "B"] as const) {
    const t = TENANTS[key];
    const tenantId = await upsertTenant(t);
    const userId = await upsertUser(t.email);
    await linkTenantUser(tenantId, userId);
    const pipelineId = await upsertPipeline(tenantId);
    const leadId = await upsertMarkerLead(tenantId, pipelineId, `${t.name} Marker Lead`);
    const accessToken = await signIn(t.email);
    out[key] = { tenantId, userId, pipelineId, leadId, accessToken };
    console.log(`Fixture ${key}: tenant=${tenantId} user=${userId} lead=${leadId}`);
  }
  return out;
}

async function cleanup() {
  console.log("Cleaning up RLS probe fixtures...");
  for (const key of ["A", "B"] as const) {
    const t = TENANTS[key];
    const { data: tenant } = await serviceClient.from("tenants").select("id").eq("slug", t.slug).maybeSingle();
    if (tenant) {
      const { error } = await serviceClient.from("tenants").delete().eq("id", tenant.id);
      if (error) console.error(`  failed to delete tenant ${t.slug}: ${error.message}`);
      else console.log(`  deleted tenant ${t.slug} (cascades tenant_users/pipelines/leads)`);
    }
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signIn } = await anon.auth.signInWithPassword({ email: t.email, password: PASSWORD });
    if (signIn.user) {
      const { error } = await serviceClient.auth.admin.deleteUser(signIn.user.id);
      if (error) console.error(`  failed to delete user ${t.email}: ${error.message}`);
      else console.log(`  deleted user ${t.email}`);
    }
  }
  console.log("Cleanup done.");
}

async function main() {
  if (CLEANUP) {
    await cleanup();
    return;
  }

  console.log(`Target: ${SUPABASE_URL}\n`);
  const fixtures = await setup();
  const A = fixtures.A;
  const B = fixtures.B;
  const clientA = userClient(A.accessToken);

  console.log("\n--- Probes (running as tenant A's user, through anon-key + JWT) ---\n");

  // Probe 1 — cross-tenant SELECT: A's query must contain A's marker, not B's.
  {
    const { data, error } = await clientA.from("leads").select("id,tenant_id").eq("idempotency_key", MARKER_KEY);
    const ids = (data ?? []).map((r) => r.id as string);
    const ok = !error && ids.includes(A.leadId) && !ids.includes(B.leadId);
    report("Probe 1 — cross-tenant SELECT filters out tenant B", ok, error ? error.message : `rows=${ids.length}`);
  }

  // Probe 2 — direct-by-id: selecting B's lead id by primary key returns 0 rows.
  {
    const { data, error } = await clientA.from("leads").select("id").eq("id", B.leadId);
    const ok = !error && (data ?? []).length === 0;
    report("Probe 2 — direct select-by-id on tenant B's lead returns 0 rows", ok, error?.message);
  }

  // Probe 3 — cross-tenant write: insert into B, update B's row, both rejected.
  {
    const { data, error } = await clientA
      .from("leads")
      .insert({ tenant_id: B.tenantId, pipeline_id: B.pipelineId, first_name: "should not exist" })
      .select();
    const ok = !!error || (data ?? []).length === 0;
    report(
      "Probe 3a — cross-tenant INSERT into tenant B rejected",
      ok,
      error ? error.message : `rows=${(data ?? []).length}`,
    );
    if (!error) {
      console.log(
        "  NOTE: no error was returned — see runbook 'no authenticated INSERT policy on leads' finding.",
      );
    }
  }
  {
    const { data, error } = await clientA
      .from("leads")
      .update({ status: "contacted" })
      .eq("id", B.leadId)
      .select();
    const ok = !error && (data ?? []).length === 0;
    report("Probe 3b — cross-tenant UPDATE of tenant B's lead affects 0 rows", ok, error?.message);

    const { data: verify } = await serviceClient.from("leads").select("status").eq("id", B.leadId).single();
    report(
      "Probe 3b (verify) — tenant B's lead status unchanged after A's update attempt",
      verify?.status === "new",
      `status=${verify?.status}`,
    );
  }

  // Probe 4 — CONTROL (anti-false-green): service-role sees both markers, and
  // the probe session is confirmed to be a real 'authenticated' JWT, not
  // service_role — otherwise probes 1-3 would false-green regardless of RLS.
  {
    const { data, error } = await serviceClient
      .from("leads")
      .select("id,tenant_id")
      .eq("idempotency_key", MARKER_KEY);
    const ids = (data ?? []).map((r) => r.id as string);
    const bothVisible = !error && ids.includes(A.leadId) && ids.includes(B.leadId);
    report("Probe 4a — CONTROL: service-role sees both tenants' markers", bothVisible, `rows=${ids.length}`);

    const role = decodeJwtRole(A.accessToken);
    report("Probe 4b — CONTROL: probe session JWT role is 'authenticated', not service_role", role === "authenticated", `role=${role}`);

    const { data: asA } = await clientA.from("leads").select("id").eq("idempotency_key", MARKER_KEY);
    const sameAsControl = bothVisible && (asA ?? []).length === ids.length;
    if (sameAsControl) {
      report(
        "Probe 4c — CONTROL: user A's result differs from service-role's (RLS is actually filtering)",
        false,
        "user A saw the SAME rows as service-role — this probe is NOT RLS-enforcing (empty-data or wrong-client false-green)",
      );
    } else {
      report("Probe 4c — CONTROL: user A's result differs from service-role's (RLS is actually filtering)", true);
    }
  }

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
