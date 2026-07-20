import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

// Data-room document types. `other` is the catch-all; null is also allowed.
const DOC_TYPES = ["ppm", "operating_agreement", "financials", "other"] as const;

const DOCUMENT_SELECT =
  "id, offering_id, name, storage_path, content_type, size_bytes, doc_type, uploaded_by, created_at";

// Industry gate shared by every method here. OFFERINGS is already scoped to
// real_estate only, so getFeatureAccess is sufficient; the explicit industry
// check is belt-and-suspenders (brief C.3).
function offeringsAllowed(industryId: string | null): boolean {
  return getFeatureAccess(industryId, FEATURES.OFFERINGS) && industryId === "real_estate";
}

// GET /api/v1/offerings/[id]/documents — list non-deleted docs for one offering.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id: offeringId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!offeringsAllowed(auth.industryId)) return apiForbidden();

  const db = await scopedClient(auth);

  // Confirm the offering is in this tenant (RLS also enforces; 404 is cleaner).
  const { data: offering } = await db
    .from("offerings")
    .select("id")
    .eq("id", offeringId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!offering) return apiNotFound("Offering");

  const { data, error } = await db
    .from("offering_documents")
    .select(DOCUMENT_SELECT)
    .eq("offering_id", offeringId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch documents", 500);
  return apiSuccess(data ?? []);
}

// POST /api/v1/offerings/[id]/documents — record metadata AFTER the file has been
// uploaded via the presigned /api/v1/upload route (bucket: lead-documents).
export async function POST(request: NextRequest, { params }: Props) {
  const { id: offeringId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/offerings/${offeringId}/documents` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!offeringsAllowed(auth.industryId)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const name = body.name ? String(body.name).trim() : "";
  if (!name) return apiValidationError({ name: ["A document name is required"] });
  if (name.length > 255) return apiValidationError({ name: ["Name must be 255 characters or fewer"] });

  const storagePath = body.storage_path ? String(body.storage_path).trim() : "";
  if (!storagePath) return apiValidationError({ storage_path: ["storage_path is required"] });

  let docType: string | null = null;
  if (body.doc_type !== undefined && body.doc_type !== null && body.doc_type !== "") {
    if (!DOC_TYPES.includes(body.doc_type as never)) {
      return apiValidationError({ doc_type: [`Must be one of: ${DOC_TYPES.join(", ")}`] });
    }
    docType = body.doc_type as string;
  }

  let sizeBytes: number | null = null;
  if (body.size_bytes !== undefined && body.size_bytes !== null && body.size_bytes !== "") {
    const n = Number(body.size_bytes);
    if (!Number.isFinite(n) || n < 0) {
      return apiValidationError({ size_bytes: ["Must be a non-negative number"] });
    }
    sizeBytes = n;
  }

  const contentType = body.content_type ? String(body.content_type) : null;

  const db = await scopedClient(auth);

  // Offering must be in this tenant (scopedClient auto-filters tenant_id).
  const { data: offering } = await db
    .from("offerings")
    .select("id")
    .eq("id", offeringId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!offering) return apiNotFound("Offering");

  // tenant_id is auto-injected/stripped by scopedClient — do NOT pass it here.
  const { data: created, error } = await db
    .from("offering_documents")
    .insert({
      offering_id: offeringId,
      name,
      storage_path: storagePath,
      content_type: contentType,
      size_bytes: sizeBytes,
      doc_type: docType,
      uploaded_by: auth.userId,
    })
    .select(DOCUMENT_SELECT)
    .single();

  if (error) {
    log.error({ error }, "Failed to record offering document");
    return apiError("DB_ERROR", "Failed to save document", 500);
  }

  return apiSuccess(created, 201);
}
