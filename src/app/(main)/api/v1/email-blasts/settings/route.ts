import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiForbidden, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

// Mirrors src/app/(main)/api/v1/sms/settings/route.ts exactly — F4
// (docs/BLAST-F3-F4-FIX-BRIEF.md item 3) calls for the same shape, not a new
// one. Only the recipient-cap field exists here today; daily_send_cap and
// bulk_email_enabled (migration 211) are ops-managed, not surfaced through
// this admin-facing route yet.

const DEFAULT_MAX_RECIPIENTS_PER_BLAST = 2000;

interface TenantEmailSettingsRow {
  max_recipients_per_blast?: number;
}

// GET /api/v1/email-blasts/settings
export async function GET() {
  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const { data } = await db.from("tenant_email_settings").select("max_recipients_per_blast").maybeSingle();
  const row = data as TenantEmailSettingsRow | null;

  return apiSuccess({
    max_recipients_per_blast: row?.max_recipients_per_blast ?? DEFAULT_MAX_RECIPIENTS_PER_BLAST,
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

  if (b.max_recipients_per_blast === undefined) {
    return apiValidationError({ body: ["No editable fields provided"] });
  }

  const n = Number(b.max_recipients_per_blast);
  if (!Number.isInteger(n) || n < 1 || n > 20000) {
    return apiValidationError({ max_recipients_per_blast: ["Must be an integer between 1 and 20000"] });
  }

  const { data, error } = await db
    .from("tenant_email_settings")
    .upsert({ max_recipients_per_blast: n, updated_by: auth.userId }, { onConflict: "tenant_id", ignoreDuplicates: false })
    .select("max_recipients_per_blast")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update email blast settings");
    return apiServiceUnavailable("Failed to update email blast settings");
  }

  return apiSuccess(data);
}
