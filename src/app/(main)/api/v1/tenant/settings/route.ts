import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import type { Tenant } from "@/types/database";

const WEEKDAY_NUMS = [0, 1, 2, 3, 4, 5, 6];

export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/tenant/settings" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const patch: Record<string, unknown> = {};

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !body.timezone.trim()) {
      return apiValidationError({ timezone: ["Timezone must be a non-empty string"] });
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: body.timezone });
    } catch {
      return apiValidationError({ timezone: ["Not a valid IANA timezone"] });
    }
    patch.timezone = body.timezone;
  }

  if (body.weekend_days !== undefined) {
    if (
      !Array.isArray(body.weekend_days) ||
      !body.weekend_days.every((d) => typeof d === "number" && WEEKDAY_NUMS.includes(d))
    ) {
      return apiValidationError({ weekend_days: ["Must be an array of integers 0-6 (0=Sun … 6=Sat)"] });
    }
    const dedupedWeekendDays = Array.from(new Set(body.weekend_days as number[])).sort();
    if (dedupedWeekendDays.length < 1 || dedupedWeekendDays.length > 6) {
      return apiValidationError({ weekend_days: ["Must leave at least one working day"] });
    }
    patch.weekend_days = dedupedWeekendDays;
  }

  if (Object.keys(patch).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  // The tenants table has no tenant_id column (its own id IS the tenant id),
  // so scopedClient's auto `.eq("tenant_id", ...)` doesn't apply here — use
  // the raw() escape hatch and scope explicitly by id instead.
  const db = await scopedClient(auth);
  const { data, error } = await db
    .raw()
    .from("tenants")
    .update(patch)
    .eq("id", auth.tenantId)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update tenant settings");
    return apiServiceUnavailable("Failed to update tenant settings");
  }

  log.info({ patch }, "Tenant locale settings updated");
  return apiSuccess(data as Tenant);
}
