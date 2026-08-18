/**
 * SMS credit grant CLI
 *
 * Grants a slice of EdgeX's single shared 100,000-credit Aakash pool to one
 * tenant. This is a platform-owned pool, not a per-tenant provider account —
 * see docs/SMS-PHASE1-BRIEF.md §1. Creates the sms_credit_accounts row if
 * absent, writes a 'grant' ledger entry, and flips
 * tenants.entitlement_overrides.sms_enabled = true.
 *
 * Usage:
 *   npx tsx scripts/grant-sms-credits.ts --list
 *   npx tsx scripts/grant-sms-credits.ts --tenant admizz --credits 2000
 *   npx tsx scripts/grant-sms-credits.ts --tenant admizz --credits 2000 \
 *     --apply --yes-i-reviewed-the-dry-run
 *
 * HARD RULES:
 *   - Dry-run is the default. --apply requires --yes-i-reviewed-the-dry-run.
 *   - Pool guard: refuses to apply if granting would over-allocate the shared
 *     pool (sum of lifetime_granted - lifetime_consumed across all tenants,
 *     compared against live available-credit when reachable, else SMS_POOL_TOTAL).
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

const LIST = args.includes("--list");
const TENANT_SLUG = flag("tenant");
const CREDITS_RAW = flag("credits");
const APPLY = args.includes("--apply");
const REVIEWED = args.includes("--yes-i-reviewed-the-dry-run");

const DEFAULT_POOL_TOTAL = Number(process.env.SMS_POOL_TOTAL || 100_000);

async function listTenants() {
  const { data, error } = await supabase.from("tenants").select("slug, name").order("slug");
  if (error) {
    console.error(`Failed to list tenants: ${error.message}`);
    process.exit(1);
  }
  console.log("Available tenant slugs:");
  for (const t of data ?? []) console.log(`  ${t.slug}  (${t.name})`);
}

async function poolUtilization(): Promise<{ granted: number; consumed: number; outstanding: number }> {
  const { data, error } = await supabase.from("sms_credit_accounts").select("lifetime_granted, lifetime_consumed");
  if (error) throw new Error(`Failed to read sms_credit_accounts: ${error.message}`);
  const granted = (data ?? []).reduce((sum, r) => sum + (r.lifetime_granted ?? 0), 0);
  const consumed = (data ?? []).reduce((sum, r) => sum + (r.lifetime_consumed ?? 0), 0);
  return { granted, consumed, outstanding: granted - consumed };
}

async function main() {
  if (LIST) {
    await listTenants();
    return;
  }

  if (!TENANT_SLUG || !CREDITS_RAW) {
    console.error("Usage: grant-sms-credits.ts --tenant <slug> --credits <n> [--apply --yes-i-reviewed-the-dry-run]");
    console.error("       grant-sms-credits.ts --list");
    process.exit(1);
  }

  const credits = Number(CREDITS_RAW);
  if (!Number.isFinite(credits) || credits <= 0) {
    console.error(`Invalid --credits value: ${CREDITS_RAW}`);
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

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, slug, name, entitlement_overrides")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();

  if (tErr || !tenant) {
    console.error(`Tenant slug "${TENANT_SLUG}" not found. Aborting.`);
    await listTenants();
    process.exit(1);
  }

  const utilization = await poolUtilization();
  let liveBalance: number | null = null;
  try {
    const token = process.env.AAKASH_SMS_TOKEN;
    if (token) {
      const res = await fetch(`${process.env.AAKASH_SMS_BASE_URL || "https://sms.aakashsms.com"}/sms/v4/available-credit`, {
        headers: { "auth-token": token },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { credit?: number; balance?: number };
        liveBalance = json.credit ?? json.balance ?? null;
      }
    }
  } catch {
    liveBalance = null;
  }

  const poolTotal = liveBalance ?? DEFAULT_POOL_TOTAL;
  const wouldOutstanding = utilization.outstanding + credits;

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(APPLY ? "APPLYING sms credit grant" : "DRY-RUN — no writes will be made");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Tenant:              ${tenant.name} (${tenant.slug})`);
  console.log(`Grant:               ${credits} credits`);
  console.log(`Pool source:         ${liveBalance !== null ? "live Aakash available-credit" : `SMS_POOL_TOTAL fallback (${DEFAULT_POOL_TOTAL})`}`);
  console.log(`Pool total:          ${poolTotal}`);
  console.log(`Outstanding before:  ${utilization.outstanding} (granted ${utilization.granted} - consumed ${utilization.consumed})`);
  console.log(`Outstanding after:   ${wouldOutstanding}`);
  console.log(`Pool utilization:    ${((wouldOutstanding / poolTotal) * 100).toFixed(1)}%`);
  console.log("──────────────────────────────────────────────────────────────\n");

  if (wouldOutstanding > poolTotal) {
    console.error(
      `⛔  Refusing: granting ${credits} credits would push outstanding allocation to ${wouldOutstanding}, ` +
        `exceeding the ${poolTotal}-credit pool. Reduce the grant or top up the pool first.`
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply --yes-i-reviewed-the-dry-run to grant.\n");
    return;
  }

  const { data: existingAccount } = await supabase
    .from("sms_credit_accounts")
    .select("balance, reserved, lifetime_granted, lifetime_consumed")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  const before = existingAccount?.balance ?? 0;

  if (!existingAccount) {
    const { error: insErr } = await supabase.from("sms_credit_accounts").insert({
      tenant_id: tenant.id,
      balance: credits,
      reserved: 0,
      lifetime_granted: credits,
      lifetime_consumed: 0,
    });
    if (insErr) {
      console.error(`Failed to create sms_credit_accounts row: ${insErr.message}`);
      process.exit(1);
    }
  } else {
    const { error: updErr } = await supabase
      .from("sms_credit_accounts")
      .update({
        balance: existingAccount.balance + credits,
        lifetime_granted: existingAccount.lifetime_granted + credits,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenant.id);
    if (updErr) {
      console.error(`Failed to update sms_credit_accounts row: ${updErr.message}`);
      process.exit(1);
    }
  }

  const after = before + credits;

  const { error: ledgerErr } = await supabase.from("sms_credit_ledger").insert({
    tenant_id: tenant.id,
    delta: credits,
    reason: "grant",
    balance_after: after,
    ref_type: "manual_grant",
    notes: `granted via scripts/grant-sms-credits.ts`,
  });
  if (ledgerErr) {
    console.error(`Failed to write ledger row: ${ledgerErr.message}`);
    process.exit(1);
  }

  const { error: entErr } = await supabase
    .from("tenants")
    .update({
      entitlement_overrides: { ...(tenant.entitlement_overrides ?? {}), sms_enabled: true },
    })
    .eq("id", tenant.id);
  if (entErr) {
    console.error(`Failed to set entitlement_overrides.sms_enabled: ${entErr.message}`);
    process.exit(1);
  }

  console.log(`✅ Granted ${credits} credits to ${tenant.slug}.`);
  console.log(`   Balance before: ${before}`);
  console.log(`   Balance after:  ${after}`);
  console.log(`   entitlement_overrides.sms_enabled = true\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
