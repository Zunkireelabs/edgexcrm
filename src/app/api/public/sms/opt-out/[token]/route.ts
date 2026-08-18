import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { apiSuccess } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { suppressPhone } from "@/lib/sms/suppression";

// Public, unauthenticated opt-out link (see docs/SMS-PHASE2-BRIEF.md §2g).
//
// THE SINGLE MOST IMPORTANT RULE HERE: GET must never opt anyone out. Carrier
// link-scanners and antivirus proxies fetch every URL in an SMS before a human
// sees it — if GET suppressed, that alone would silently unsubscribe people
// who never touched the link, invisibly. Only POST suppresses.
//
// An unknown token renders a neutral "not valid" response — never a 404,
// never an error trace, never anything that reveals whether the token exists.

interface RouteContext {
  params: Promise<{ token: string }>;
}

interface OptOutTokenRow {
  token: string;
  tenant_id: string;
  phone_e164: string;
  lead_id: string | null;
  used_at: string | null;
}

function maskPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/[^0-9]/g, "");
  const local = digits.startsWith("977") ? digits.slice(3) : digits;
  if (local.length < 5) return "•••••";
  return `${local.slice(0, 2)}${"•".repeat(local.length - 5)}${local.slice(-3)}`;
}

async function lookupToken(supabase: Awaited<ReturnType<typeof createServiceClient>>, token: string) {
  const { data, error } = await supabase
    .from("sms_optout_tokens")
    .select("token, tenant_id, phone_e164, lead_id, used_at")
    .eq("token", token)
    .maybeSingle();
  return { data: data as OptOutTokenRow | null, error };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: `/api/public/sms/opt-out/${token.slice(0, 4)}` });

  const supabase = await createServiceClient();
  const { data, error } = await lookupToken(supabase, token);

  if (error || !data) {
    log.info({ token: token.slice(0, 4) }, "Opt-out token not found");
    return apiSuccess({ valid: false, reason: "This link is no longer valid." });
  }

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", data.tenant_id).single();

  return apiSuccess({
    valid: true,
    tenantName: (tenant as { name: string } | null)?.name ?? "this sender",
    maskedPhone: maskPhone(data.phone_e164),
  });
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/public/sms/opt-out/${token.slice(0, 4)}` });

  const supabase = await createServiceClient();
  const { data, error } = await lookupToken(supabase, token);

  if (error || !data) {
    // Neutral response — same shape as an unknown token would get from GET.
    // Never a 4xx that would let a scanner distinguish "invalid" from "valid
    // but something else went wrong."
    return apiSuccess({ valid: false, reason: "This link is no longer valid." });
  }

  const scoped = await scopedClientForTenant(data.tenant_id);

  await suppressPhone(scoped, data.tenant_id, {
    phoneE164: data.phone_e164,
    reason: "opt_out",
    source: "optout_link",
    leadId: data.lead_id,
  });

  // used_at is a record, not a gate — the link keeps working after use, so
  // this is a plain update every time, not conditioned on used_at being null.
  const { error: touchError } = await supabase
    .from("sms_optout_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  if (touchError) {
    // The suppression row is already written — that's the behavior that
    // matters. Log and continue; a stale used_at is cosmetic.
    log.error({ err: touchError, token: token.slice(0, 4) }, "Failed to touch sms_optout_tokens.used_at");
  }

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", data.tenant_id).single();

  log.info({ tenantId: data.tenant_id }, "SMS opt-out recorded");

  return apiSuccess({
    valid: true,
    optedOut: true,
    tenantName: (tenant as { name: string } | null)?.name ?? "this sender",
    maskedPhone: maskPhone(data.phone_e164),
  });
}
