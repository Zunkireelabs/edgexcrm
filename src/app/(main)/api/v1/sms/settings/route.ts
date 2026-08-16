import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiForbidden, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { loadTenantSmsSettings } from "@/lib/sms/settings";
import { createRequestLogger } from "@/lib/logger";

const EDITABLE_FIELDS = [
  "sender_label",
  "quiet_hours_start",
  "quiet_hours_end",
  "quiet_hours_enabled",
  "timezone",
  "optout_footer",
  "max_recipients_per_blast",
  "low_credit_threshold",
] as const;

// GET /api/v1/sms/settings
export async function GET() {
  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;

  const settings = await loadTenantSmsSettings(db);
  return apiSuccess(settings);
}

// PATCH /api/v1/sms/settings — admin-only (SMS-PHASE3A-BRIEF.md §4).
export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/sms/settings" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  if (!requireAdmin(auth)) return apiForbidden("Only an owner or admin can change SMS settings");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return apiValidationError({ body: ["Request body must be a JSON object"] });
  const b = body as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (b[field] !== undefined) patch[field] = b[field];
  }
  if (Object.keys(patch).length === 0) return apiValidationError({ body: ["No editable fields provided"] });

  if (patch.max_recipients_per_blast !== undefined) {
    const n = Number(patch.max_recipients_per_blast);
    if (!Number.isInteger(n) || n < 1 || n > 20000) {
      return apiValidationError({ max_recipients_per_blast: ["Must be an integer between 1 and 20000"] });
    }
  }
  if (patch.quiet_hours_start !== undefined || patch.quiet_hours_end !== undefined) {
    for (const key of ["quiet_hours_start", "quiet_hours_end"] as const) {
      if (patch[key] === undefined) continue;
      const n = Number(patch[key]);
      if (!Number.isInteger(n) || n < 0 || n > 23) {
        return apiValidationError({ [key]: ["Must be an integer between 0 and 23"] });
      }
    }
  }

  patch.updated_by = auth.userId;

  const { data, error } = await db
    .from("tenant_sms_settings")
    .upsert(patch, { onConflict: "tenant_id", ignoreDuplicates: false })
    .select("*")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update sms settings");
    return apiServiceUnavailable("Failed to update SMS settings");
  }

  return apiSuccess(data);
}
