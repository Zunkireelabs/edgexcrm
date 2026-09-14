import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { assertDocumentVisible } from "@/lib/documents/access";
import { DOCUMENT_TYPE_CATEGORY, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS } from "../../features/applicant-documents/labels";

const inputSchema = z.object({
  documentId: optionalUuid(z.string().uuid()).describe(
    "The document's id (from list_applicant_documents or search_applicant_document_content's citation payload)",
  ),
});

export const getDocumentMetadataTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_document_metadata",
  description:
    "Get one document's metadata — type, category, file size, processing status, verification status, upload " +
    "date, description. Does not return the document's extracted content or file bytes; use " +
    "search_applicant_document_content for content and get_document_download_url for the file itself.",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    assertUserAuth(auth);
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) {
      return { error: "Document management is not available for this tenant." };
    }

    const resolved = await assertDocumentVisible(db, auth, input.documentId);
    if (!resolved) return { error: "Document not found." };
    const { document } = resolved;

    return {
      id: document.id,
      name: document.name,
      documentType: document.document_type,
      documentTypeLabel: DOCUMENT_TYPE_LABELS[document.document_type as DocumentType],
      category: DOCUMENT_CATEGORY_LABELS[DOCUMENT_TYPE_CATEGORY[document.document_type as DocumentType] ?? "other"],
      status: document.status,
      verificationStatus: document.verification_status,
      fileSize: document.file_size,
      description: document.description,
      uploadedAt: document.created_at,
      processedAt: document.processed_at,
    };
  },
};
