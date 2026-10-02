import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess, requireEmailCampaignsFeature } from "@/lib/email/outbound/api-guard";
import { requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiForbidden, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { DAILY_SEND_CAP_MAX, DAILY_SEND_CAP_MIN, DEFAULT_DAILY_CAP } from "@/lib/email/outbound/cap";

// Mirrors src/app/(main)/api/v1/sms/settings/route.ts exactly — F4
// (docs/BLAST-F3-F4-FIX-BRIEF.md item 3) calls for the same shape, not a new
// one. Editable here: the per-blast recipient cap and (Outreach bulk enroll, Phase 2c) the tenant's
// daily send limit (daily_send_cap, migration 211) within DAILY_SEND_CAP_MIN..MAX. bulk_email_enabled
// (migration 211) is still ops-managed and never surfaced through this route.

const DEFAULT_MAX_RECIPIENTS_PER_BLAST = 2000;

interface TenantEmailSettingsRow {
  max_recipients_per_blast?: number;
  daily_send_cap?: number;
}

// GET /api/v1/email-blasts/settings — feature-gated only, not bulk-email-enabled-gated.
// Reading the recipient cap is not a bulk-email action, and every tenant with the
// Communications panel visible needs this to succeed even before bulk email is switched
// on for them (bulk_email_enabled defaults to false, migration 211).
export async function GET() {
  const guard = await requireEmailCampaignsFeature();
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const { data } = await db.from("tenant_email_settings").select("max_recipients_per_blast, daily_send_cap").maybeSingle();
  const row = data as TenantEmailSettingsRow | null;

  return apiSuccess({
    max_recipients_per_blast: row?.max_recipients_per_blast ?? DEFAULT_MAX_RECIPIENTS_PER_BLAST,
    daily_send_cap: row?.daily_send_cap ?? DEFAULT_DAILY_CAP,
    daily_send_cap_min: DAILY_SEND_CAP_MIN,
    daily_send_cap_max: DAILY_SEND_CAP_MAX,
  });
}

// PATCH /api/v1/email-blasts/settings — admin-only.
export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/email-blasts/settings" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  if (!requireAdmin(auth)) return apiForbidden("Only an owner or admin can change email blast settings");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return apiValidationError({ body: ["Request body must be a JSON object"] });
  const b = body as Record<string, unknown>;

  if (b.max_recipients_per_blast === undefined && b.daily_send_cap === undefined) {
    return apiValidationError({ body: ["No editable fields provided"] });
  }

  // Only the fields that were sent are written — saving one never resets the other.
  const patch: Record<string, unknown> = { updated_by: auth.userId };

  if (b.max_recipients_per_blast !== undefined) {
    const n = Number(b.max_recipients_per_blast);
    if (!Number.isInteger(n) || n < 1 || n > 20000) {
      return apiValidationError({ max_recipients_per_blast: ["Must be an integer between 1 and 20000"] });
    }
    patch.max_recipients_per_blast = n;
  }

  if (b.daily_send_cap !== undefined) {
    const n = Number(b.daily_send_cap);
    if (!Number.isInteger(n) || n < DAILY_SEND_CAP_MIN || n > DAILY_SEND_CAP_MAX) {
      return apiValidationError({
        daily_send_cap: [`Must be an integer between ${DAILY_SEND_CAP_MIN} and ${DAILY_SEND_CAP_MAX}`],
      });
    }
    patch.daily_send_cap = n;
  }

  const { data, error } = await db
    .from("tenant_email_settings")
    .upsert(patch, { onConflict: "tenant_id", ignoreDuplicates: false })
    .select("max_recipients_per_blast, daily_send_cap")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update email blast settings");
    return apiServiceUnavailable("Failed to update email blast settings");
  }

  return apiSuccess(data);
}
