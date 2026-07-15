import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string; docId: string }>;
}

function offeringsAllowed(industryId: string | null): boolean {
  return getFeatureAccess(industryId, FEATURES.OFFERINGS) && industryId === "real_estate";
}

// DELETE /api/v1/offerings/[id]/documents/[docId] — soft-delete one data-room doc.
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id: offeringId, docId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!offeringsAllowed(auth.industryId)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  // Soft delete. Explicit id + offering_id filters beyond the auto-injected
  // tenant filter (scopedClient rule: mutations need a caller-supplied filter).
  const { data, error } = await db
    .from("offering_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", docId)
    .eq("offering_id", offeringId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to delete document", 500);
  if (!data) return apiNotFound("Document");
  return apiSuccess({ id: (data as { id: string }).id, deleted: true });
}
