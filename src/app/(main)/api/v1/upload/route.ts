import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiNotFound,
  apiRateLimited,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { checkRateLimit, FORM_SUBMIT_LIMIT } from "@/lib/api/rate-limit";
import { createRequestLogger } from "@/lib/logger";

const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/upload",
    ip,
  });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  // Validate required fields
  const { valid, errors } = validate(body, {
    tenant_id: [required("tenant_id"), isUUID()],
    file_name: [required("file_name")],
    file_size: [required("file_size")],
    mime_type: [required("mime_type")],
    field_name: [required("field_name")],
  });
  if (!valid) return apiValidationError(errors);

  const tenantId = body.tenant_id as string;

  // Rate limit by tenant + IP
  const rateResult = await checkRateLimit(
    `upload:${tenantId}:${ip}`,
    FORM_SUBMIT_LIMIT
  );
  if (!rateResult.allowed) {
    if (rateResult.retryAfterSeconds > 0) {
      return apiRateLimited(rateResult.retryAfterSeconds);
    }
    return apiServiceUnavailable("Rate limiter unavailable");
  }

  const supabase = await createServiceClient();

  // Fetch tenant with config
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, config")
    .eq("id", tenantId)
    .single();

  if (!tenant) return apiNotFound("Tenant");

  const config = (tenant.config || {}) as Record<string, unknown>;
  const maxFileSizeMb = (config.max_file_size_mb as number) || DEFAULT_MAX_FILE_SIZE_MB;
  const acceptedTypes = (config.accepted_file_types as string[]) || DEFAULT_ACCEPTED_TYPES;

  const fileSize = Number(body.file_size);
  const mimeType = body.mime_type as string;
  const fileName = body.file_name as string;
  const fieldName = body.field_name as string;
  const sessionId = (body.session_id as string) || "unknown";

  // Validate file size
  const maxBytes = maxFileSizeMb * 1024 * 1024;
  if (fileSize > maxBytes) {
    return apiValidationError({
      file_size: [`File too large. Maximum size is ${maxFileSizeMb}MB`],
    });
  }

  // Validate MIME type
  if (!acceptedTypes.includes(mimeType)) {
    return apiValidationError({
      mime_type: [`File type "${mimeType}" is not accepted. Allowed: ${acceptedTypes.join(", ")}`],
    });
  }

  // Generate storage path
  const ext = fileName.split(".").pop() || "bin";
  const path = `${tenant.slug}/${sessionId}/${fieldName}.${ext}`;

  // Create signed upload URL
  const { data: signedData, error } = await supabase.storage
    .from("lead-documents")
    .createSignedUploadUrl(path);

  if (error) {
    log.error({ err: error }, "Failed to create signed upload URL");
    return apiServiceUnavailable("Failed to generate upload URL");
  }

  const publicUrl = supabase.storage
    .from("lead-documents")
    .getPublicUrl(path).data.publicUrl;

  log.info({ path, tenantId }, "Signed upload URL generated");

  return apiSuccess({
    signed_url: signedData.signedUrl,
    token: signedData.token,
    path,
    public_url: publicUrl,
  });
}
