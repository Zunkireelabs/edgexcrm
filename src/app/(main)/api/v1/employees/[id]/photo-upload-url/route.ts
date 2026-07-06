import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, isIn, isPositiveInt } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getSelfTenantUserId, canWriteEmployee } from "@/lib/api/hr-scope";

const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const PHOTO_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/employees/${id}/photo-upload-url` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db.from("tenant_users").select("id").eq("id", id).maybeSingle();
  if (!memberRow) return apiNotFound("Employee");
  if (!canWriteEmployee(selfId, hasManageHR, id)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    file_name: [required("file_name")],
    file_size: [required("file_size"), isPositiveInt()],
    mime_type: [required("mime_type"), isIn(PHOTO_ACCEPTED_TYPES)],
  });
  if (!valid) return apiValidationError(errors);

  const fileSize = Number(body.file_size);
  if (fileSize > PHOTO_MAX_BYTES) {
    return apiValidationError({ file_size: [`File exceeds maximum size of ${PHOTO_MAX_BYTES} bytes`] });
  }

  const fileName = String(body.file_name);
  const ext = fileName.includes(".") ? fileName.split(".").pop() || "bin" : "bin";
  const path = `${auth.tenantId}/${id}/photo.${ext}`;

  const { data: signedData, error: storageError } = await db
    .raw()
    .storage.from("employee-photos")
    .createSignedUploadUrl(path, { upsert: true });

  if (storageError || !signedData) {
    log.error({ error: storageError }, "Failed to create signed upload URL for employee photo");
    return apiError("STORAGE_ERROR", "Failed to create upload URL", 500);
  }

  log.info({ tenantUserId: id, path }, "Signed photo upload URL created");
  return apiSuccess({ signed_url: signedData.signedUrl, token: signedData.token, path });
}
