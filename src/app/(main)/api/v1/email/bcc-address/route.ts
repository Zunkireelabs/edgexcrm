// GET/POST /api/v1/email/bcc-address — brief §6.
//
// A caller may only ever mint/read/regenerate THEIR OWN dropbox
// (user_id = auth.userId), regardless of role. This route runs through a
// service-backed client, so inbound_addresses' RLS (is_tenant_admin on
// insert/update) does NOT apply here — the user_id filter below is the only
// thing enforcing that, and it must never be dropped.
//
// Double-gated same as the send path (EDGEX_INBOUND_ENABLED &&
// tenant_email_settings.inbound_enabled) — off means 404 and the UI panel
// does not render.

import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiNotFound, apiSuccess, apiInternalError, apiRateLimited } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { checkRateLimit, BCC_REGENERATE_LIMIT } from "@/lib/api/rate-limit";
import { mintToken, buildInboundAddress } from "@/lib/email/inbound/tokens";
import { logger } from "@/lib/logger";

interface DropboxRow {
  id: string;
  token: string;
}

async function inboundGateOpen(db: Awaited<ReturnType<typeof scopedClient>>): Promise<boolean> {
  if (process.env.EDGEX_INBOUND_ENABLED !== "true") return false;
  const { data: settings } = await db
    .from("tenant_email_settings")
    .select("inbound_enabled")
    .maybeSingle<{ inbound_enabled: boolean }>();
  return !!settings?.inbound_enabled;
}

async function findActiveDropbox(
  db: Awaited<ReturnType<typeof scopedClient>>,
  userId: string,
): Promise<DropboxRow | null> {
  const { data } = await db
    .from("inbound_addresses")
    .select("id, token")
    .eq("kind", "user")
    .eq("verb", "bcc")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<DropboxRow>();
  return data ?? null;
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const db = await scopedClient(auth);
  if (!(await inboundGateOpen(db))) return apiNotFound("BCC dropbox");

  const existing = await findActiveDropbox(db, auth.userId);
  if (existing) {
    return apiSuccess({ address: buildInboundAddress("bcc", existing.token) });
  }

  // Mint on first call.
  const minted = mintToken("bcc");
  const { error: insertErr } = await db.from("inbound_addresses").insert({
    kind: "user",
    verb: "bcc",
    token: minted.token,
    thread_id: null,
    user_id: auth.userId,
    status: "active",
  });

  if (insertErr) {
    // idx_inbound_addresses_user_verb_active (mig 192) — a concurrent GET
    // already minted one; re-read rather than erroring the request.
    if (insertErr.code === "23505") {
      const raced = await findActiveDropbox(db, auth.userId);
      if (raced) return apiSuccess({ address: buildInboundAddress("bcc", raced.token) });
    }
    logger.error({ err: insertErr, userId: auth.userId }, "Failed to mint BCC dropbox address");
    return apiInternalError();
  }

  return apiSuccess({ address: minted.address });
}

export async function POST() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const db = await scopedClient(auth);
  if (!(await inboundGateOpen(db))) return apiNotFound("BCC dropbox");

  const rate = await checkRateLimit(`bcc_regenerate:${auth.userId}`, BCC_REGENERATE_LIMIT);
  if (!rate.allowed) return apiRateLimited(rate.retryAfterSeconds);

  // Revoke old, then mint new — in that order, so the partial unique index
  // (mig 192) never has to reject two simultaneously-active rows for this
  // (tenant, user, verb).
  const { error: revokeErr } = await db
    .from("inbound_addresses")
    .update({ status: "revoked" })
    .eq("kind", "user")
    .eq("verb", "bcc")
    .eq("user_id", auth.userId)
    .eq("status", "active");

  if (revokeErr) {
    logger.error({ err: revokeErr, userId: auth.userId }, "Failed to revoke old BCC dropbox address");
    return apiInternalError();
  }

  const minted = mintToken("bcc");
  const { error: insertErr } = await db.from("inbound_addresses").insert({
    kind: "user",
    verb: "bcc",
    token: minted.token,
    thread_id: null,
    user_id: auth.userId,
    status: "active",
  });

  if (insertErr) {
    logger.error({ err: insertErr, userId: auth.userId }, "Failed to mint regenerated BCC dropbox address");
    return apiInternalError();
  }

  return apiSuccess({ address: minted.address });
}
