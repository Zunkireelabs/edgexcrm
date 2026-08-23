import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { apiSuccess } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { suppressEmail } from "@/lib/email/outbound/suppression";

// Public, unauthenticated unsubscribe link. Mirrors
// src/app/api/public/sms/opt-out/[token]/route.ts (brief §6).
//
// THE SINGLE MOST IMPORTANT RULE HERE: GET must never unsubscribe. Mail
// scanners, link prefetchers and corporate security gateways follow every
// GET in an email before a human sees it — a mutating GET would silently
// unsubscribe people who never touched the link. Only POST suppresses, and
// RFC 8058 one-click clients POST directly without a confirmation step.
//
// An unknown token renders a neutral "not valid" response — never a 404,
// never an error trace, never anything that reveals whether the token exists.

interface RouteContext {
  params: Promise<{ token: string }>;
}

interface UnsubscribeTokenRow {
  token: string;
  tenant_id: string;
  email: string;
  lead_id: string | null;
  used_at: string | null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••••";
  if (local.length <= 2) return `${local[0] ?? "•"}•••@${domain}`;
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

async function lookupToken(supabase: Awaited<ReturnType<typeof createServiceClient>>, token: string) {
  const { data, error } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token, tenant_id, email, lead_id, used_at")
    .eq("token", token)
    .maybeSingle();
  return { data: data as UnsubscribeTokenRow | null, error };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: `/api/public/email/unsubscribe/${token.slice(0, 4)}` });

  const supabase = await createServiceClient();
  const { data, error } = await lookupToken(supabase, token);

  if (error || !data) {
    log.info({ token: token.slice(0, 4) }, "Unsubscribe token not found");
    return apiSuccess({ valid: false, reason: "This link is no longer valid." });
  }

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", data.tenant_id).single();

  return apiSuccess({
    valid: true,
    tenantName: (tenant as { name: string } | null)?.name ?? "this sender",
    maskedEmail: maskEmail(data.email),
  });
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/public/email/unsubscribe/${token.slice(0, 4)}` });

  const supabase = await createServiceClient();
  const { data, error } = await lookupToken(supabase, token);

  if (error || !data) {
    // Neutral response — same shape as an unknown token would get from GET.
    return apiSuccess({ valid: false, reason: "This link is no longer valid." });
  }

  const scoped = await scopedClientForTenant(data.tenant_id);

  await suppressEmail(scoped, data.tenant_id, {
    email: data.email,
    reason: "unsubscribe",
    source: "unsubscribe_link",
    leadId: data.lead_id,
  });

  // used_at is a record, not a gate — the link keeps working after use, so
  // this is a plain update every time, not conditioned on used_at being null.
  const { error: touchError } = await supabase
    .from("email_unsubscribe_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  if (touchError) {
    log.error({ err: touchError, token: token.slice(0, 4) }, "Failed to touch email_unsubscribe_tokens.used_at");
  }

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", data.tenant_id).single();

  log.info({ tenantId: data.tenant_id }, "Email unsubscribe recorded");

  return apiSuccess({
    valid: true,
    unsubscribed: true,
    tenantName: (tenant as { name: string } | null)?.name ?? "this sender",
    maskedEmail: maskEmail(data.email),
  });
}
