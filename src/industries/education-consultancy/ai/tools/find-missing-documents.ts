import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { assertLeadVisible } from "@/lib/documents/access";
import { DOCUMENT_TYPE_LABELS } from "../../features/applicant-documents/labels";
import type { DocumentType } from "@/lib/documents/constants";

const inputSchema = z.object({
  leadId: optionalUuid(z.string().uuid()).describe("The student's lead id (as returned by search_leads or get_lead)"),
});

export const findMissingDocumentsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "find_missing_documents",
  description:
    "Check which of the tenant's required document types this student (lead) has not yet uploaded. Use for " +
    "questions like \"what is <student> still missing?\" or \"is <student>'s application document-complete?\". " +
    "Returns an empty missing list (not an error) when the tenant has no required-documents checklist " +
    "configured — that means completeness can't be assessed, not that nothing is missing.",
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

    const { data: settingsData } = await db
      .from("tenant_document_settings")
      .select("required_document_types")
      .maybeSingle();
    const required = ((settingsData as unknown as { required_document_types: string[] } | null)?.required_document_types ?? []) as DocumentType[];

    if (required.length === 0) {
      return { missing: [], note: "This tenant has no required-documents checklist configured." };
    }

    const { data: docData } = await db
      .from("applicant_documents")
      .select("document_type")
      .eq("lead_id", input.leadId)
      .is("deleted_at", null);
    const uploadedTypes = new Set(((docData ?? []) as unknown as Array<{ document_type: string }>).map((d) => d.document_type));

    const missing = required.filter((t) => !uploadedTypes.has(t));

    return {
      missing: missing.map((t) => ({ documentType: t, documentTypeLabel: DOCUMENT_TYPE_LABELS[t] })),
      complete: missing.length === 0,
    };
  },
};
