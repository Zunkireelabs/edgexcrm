import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getSelfTenantUserId, canReadEmployee } from "@/lib/api/hr-scope";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db.from("tenant_users").select("id").eq("id", id).maybeSingle();
  if (!memberRow) return apiNotFound("Employee");
  if (!(await canReadEmployee(db, selfId, hasManageHR, id))) return apiForbidden();

  const { data: profile } = await db
    .from("employee_profiles")
    .select("photo_url")
    .eq("tenant_user_id", id)
    .maybeSingle();

  const photoPath = (profile as { photo_url: string | null } | null)?.photo_url;
  if (!photoPath) return apiNotFound("Employee photo");

  const { data: signed, error: storageError } = await db
    .raw()
    .storage.from("employee-photos")
    .createSignedUrl(photoPath, 300);

  if (storageError || !signed) {
    return apiError("STORAGE_ERROR", "Failed to create photo URL", 500);
  }

  return apiSuccess({ url: signed.signedUrl });
}
