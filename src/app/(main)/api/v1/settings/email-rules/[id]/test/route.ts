import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getResendClient, EMAIL_FROM } from "@/lib/email/index";
import { createRequestLogger } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/v1/settings/email-rules/:id/test — send a test email via Resend
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "POST",
    path: `/api/v1/settings/email-rules/${id}/test`,
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

  const testEmailAddr = body.test_email as string;
  if (!testEmailAddr) {
    return apiValidationError({ test_email: ["Test email address is required"] });
  }

  const resend = getResendClient();
  if (!resend) {
    return apiServiceUnavailable("Email service not configured. Set RESEND_API_KEY.");
  }

  const supabase = await createServiceClient();

  const { data: rule } = await supabase
    .from("email_forward_rules")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!rule) return apiNotFound("Email rule");

  log.info({ ruleId: id, testEmailAddr }, "Sending test email via Resend");

  const fromAddress = rule.from_name
    ? `${rule.from_name} <noreply@lead-crm.zunkireelabs.com>`
    : EMAIL_FROM;

  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: testEmailAddr,
    subject: `[TEST] ${rule.subject.replace(/\{\{\w+\}\}/g, "Sample")}`,
    html: `<div style="padding:12px;margin-bottom:16px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;font-size:14px;color:#92400e;">This is a test email. Template placeholders are shown as "Sample".</div>${rule.body.replace(/\{\{\w+\}\}/g, "Sample")}`,
  });

  if (error) {
    log.error({ ruleId: id, err: error }, "Test email failed");
    return apiServiceUnavailable(error.message || "Failed to send test email");
  }

  log.info({ ruleId: id, messageId: data?.id }, "Test email sent");
  return apiSuccess({ sent: true, messageId: data?.id });
}
