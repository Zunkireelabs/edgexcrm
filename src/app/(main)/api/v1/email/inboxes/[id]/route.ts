import { authenticateRequest } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiInternalError,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const { id } = await params;

  // Both .eq("id") AND .eq("user_id") required: scopedClient auto-adds tenant_id
  // but the caller must supply the row-level filter; without .eq("id") this would
  // delete every inbox owned by the user in the tenant.
  const db = await scopedClient(auth);
  const { error } = await db
    .from("connected_email_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId);

  if (error) return apiInternalError();

  return apiSuccess({ deleted: true });
}
