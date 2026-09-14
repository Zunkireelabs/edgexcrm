import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { assertLeadVisible } from "@/lib/documents/access";
import { DOCUMENT_TYPE_CATEGORY, type DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS } from "../../features/applicant-documents/labels";
import type { ApplicantDocumentRow } from "@/lib/documents/types";

const inputSchema = z.object({
  leadId: optionalUuid(z.string().uuid()).describe("The student's lead id (as returned by search_leads or get_lead)"),
});

export const listApplicantDocumentsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "list_applicant_documents",
  description:
    "List one student's (lead's) uploaded admissions documents — passport, transcripts, marksheets, bank " +
    "statements, etc. Shows document type, category, and processing status for each. Use for questions like " +
    "\"what has <student> uploaded?\" or \"has <student> uploaded their passport yet?\". Use " +
    "find_missing_documents instead for \"what is <student> still missing?\".",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth } = ctx;
    assertUserAuth(auth);
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) {
      return { error: "Document management is not available for this tenant." };
    }

    const lead = await assertLeadVisible(db, auth, input.leadId);
    if (!lead) return { error: "Lead not found." };

    const { data } = await db
      .from("applicant_documents")
      .select("*")
      .eq("lead_id", input.leadId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    const documents = (data ?? []) as unknown as ApplicantDocumentRow[];

    return {
      documents: documents.map((d) => ({
        id: d.id,
        name: d.name,
        documentType: d.document_type,
        documentTypeLabel: DOCUMENT_TYPE_LABELS[d.document_type as DocumentType],
        category: DOCUMENT_CATEGORY_LABELS[DOCUMENT_TYPE_CATEGORY[d.document_type as DocumentType] ?? "other"],
        status: d.status,
        verificationStatus: d.verification_status,
        uploadedAt: d.created_at,
      })),
    };
  },
};
