import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertLeadVisible } from "@/lib/documents/access";
import { DOCUMENT_TYPE_CATEGORY, type DocumentType } from "@/lib/documents/constants";
import type { ApplicantDocumentRow } from "@/lib/documents/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/:id/documents — list, grouped by document_type -> category
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const lead = await assertLeadVisible(db, auth, id);
  if (!lead) return apiNotFound("Lead");

  const { data, error } = await db
    .from("applicant_documents")
    .select("*")
    .eq("lead_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch documents", 500);

  const documents = (data ?? []) as unknown as ApplicantDocumentRow[];
  const byCategory: Record<string, ApplicantDocumentRow[]> = {};
  for (const doc of documents) {
    const category = DOCUMENT_TYPE_CATEGORY[doc.document_type as DocumentType] ?? "other";
    (byCategory[category] ??= []).push(doc);
  }

  return apiSuccess({ documents, by_category: byCategory });
}
