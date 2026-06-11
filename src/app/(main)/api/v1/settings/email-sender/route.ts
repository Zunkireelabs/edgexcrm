import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

// GET /api/v1/settings/email-sender — return tenant's email sender config
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data } = await db
    .from("tenant_email_settings")
    .select("from_name, from_address, reply_to, domain_verified, updated_at");

  return apiSuccess(
    data?.[0] ?? {
      from_name: null,
      from_address: null,
      reply_to: null,
      domain_verified: false,
      updated_at: null,
    }
  );
}

// PUT /api/v1/settings/email-sender — upsert sender config (admin-only)
export async function PUT(request: NextRequest) {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "PUT",
    path: "/api/v1/settings/email-sender",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const errors: Record<string, string[]> = {};

  const fromName = typeof body.from_name === "string" ? body.from_name.trim() : null;
  const fromAddress = typeof body.from_address === "string" ? body.from_address.trim() : null;
  const replyTo = typeof body.reply_to === "string" ? body.reply_to.trim() : null;

  if (fromAddress && !isValidEmail(fromAddress)) {
    errors.from_address = ["Must be a valid email address"];
  }
  if (replyTo && !isValidEmail(replyTo)) {
    errors.reply_to = ["Must be a valid email address"];
  }
  if (Object.keys(errors).length > 0) {
    return apiValidationError(errors);
  }

  // domain_verified is NOT settable through this route — backend/Ops only.
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tenant_email_settings")
    .upsert(
      {
        tenant_id: auth.tenantId,
        from_name: fromName || null,
        from_address: fromAddress || null,
        reply_to: replyTo || null,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      },
      { onConflict: "tenant_id" }
    )
    .select("from_name, from_address, reply_to, domain_verified, updated_at")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to upsert tenant_email_settings");
    return apiServiceUnavailable("Failed to save email sender settings");
  }

  log.info({ tenantId: auth.tenantId }, "Tenant email sender settings updated");
  return apiSuccess(data);
}
