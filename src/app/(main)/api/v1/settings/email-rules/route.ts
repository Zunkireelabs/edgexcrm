import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";

// GET /api/v1/settings/email-rules — list all rules for tenant
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("email_forward_rules")
    .select(`
      *,
      pipelines(name),
      pipeline_stages(name, color),
      connected_email_accounts(email)
    `)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return apiServiceUnavailable("Failed to fetch email rules");
  }

  // Flatten joined fields
  const rules = (data || []).map((r) => ({
    ...r,
    pipeline_name: (r.pipelines as { name: string } | null)?.name || null,
    stage_name: (r.pipeline_stages as { name: string; color: string } | null)?.name || null,
    stage_color: (r.pipeline_stages as { name: string; color: string } | null)?.color || null,
    account_email: (r.connected_email_accounts as { email: string } | null)?.email || null,
    pipelines: undefined,
    pipeline_stages: undefined,
    connected_email_accounts: undefined,
    smtp_password: r.smtp_password ? "••••••••" : null,
  }));

  return apiSuccess(rules);
}

// POST /api/v1/settings/email-rules — create a new rule
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/settings/email-rules",
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

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
    pipeline_id: [required("pipeline_id")],
    stage_id: [required("stage_id")],
    subject: [required("subject"), maxLength(500)],
    body: [required("body")],
  });
  if (!valid) return apiValidationError(errors);

  const supabase = await createServiceClient();

  // Verify pipeline and stage belong to this tenant
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id, pipeline_id")
    .eq("id", body.stage_id as string)
    .eq("pipeline_id", body.pipeline_id as string)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!stage) {
    return apiValidationError({
      stage_id: ["Invalid stage or pipeline for this tenant"],
    });
  }

  const { data: rule, error } = await supabase
    .from("email_forward_rules")
    .insert({
      tenant_id: auth.tenantId,
      name: body.name as string,
      is_active: body.is_active !== false,
      from_name: (body.from_name as string) || null,
      pipeline_id: body.pipeline_id as string,
      stage_id: body.stage_id as string,
      subject: body.subject as string,
      body: body.body as string,
    })
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to create email rule");
    return apiServiceUnavailable("Failed to create email rule");
  }

  log.info({ ruleId: rule.id }, "Email forward rule created");
  return apiSuccess({ ...rule, smtp_password: "••••••••" }, 201);
}
