import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiNotFound,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, isIn, isPositiveInt } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { KB_MAX_FILE_BYTES, KB_ACCEPTED_TYPES } from "@/lib/knowledge-base/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/knowledge-bases/${id}/upload-url`,
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
    file_name: [required("file_name")],
    file_size: [required("file_size"), isPositiveInt()],
    mime_type: [required("mime_type"), isIn([...KB_ACCEPTED_TYPES])],
  });
  if (!valid) return apiValidationError(errors);

  const fileSize = Number(body.file_size);
  if (fileSize > KB_MAX_FILE_BYTES) {
    return apiValidationError({
      file_size: [`File exceeds maximum size of ${KB_MAX_FILE_BYTES} bytes`],
    });
  }

  const db = await scopedClient(auth);
  const { data: kb } = await db.from("knowledge_bases").select("id").eq("id", id).single();
  if (!kb) return apiNotFound("Knowledge base");

  const itemId = crypto.randomUUID();
  const fileName = String(body.file_name);
  const ext = fileName.includes(".") ? fileName.split(".").pop() || "bin" : "bin";
  const path = `${auth.tenantId}/${id}/${itemId}.${ext}`;

  const { data: signedData, error: storageError } = await db
    .raw()
    .storage.from("knowledge-base-files")
    .createSignedUploadUrl(path);

  if (storageError || !signedData) {
    log.error({ error: storageError }, "Failed to create signed upload URL");
    return apiError("STORAGE_ERROR", "Failed to create upload URL", 500);
  }

  log.info({ kbId: id, itemId, path }, "Signed upload URL created");
  return apiSuccess({
    signed_url: signedData.signedUrl,
    token: signedData.token,
    path,
    item_id: itemId,
  });
}
