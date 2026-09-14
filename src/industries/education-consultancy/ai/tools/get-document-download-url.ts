import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";
import { optionalUuid } from "@/lib/ai/tools/universal/lib/sanitize";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { assertDocumentVisible } from "@/lib/documents/access";
import { getDocumentStorageProvider } from "@/lib/documents/storage/r2-provider";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import type { ApplicantDocumentVersionRow } from "@/lib/documents/types";

const inputSchema = z.object({
  documentId: optionalUuid(z.string().uuid()).describe(
    "The document's id (from list_applicant_documents or search_applicant_document_content's citation payload)",
  ),
});

// Mirrors GET /api/v1/documents/:id/download-url's expiry and audit trail
// exactly — same sensitivity, same short window, regardless of whether a
// human or the assistant requested it.
const DOWNLOAD_URL_EXPIRY_SECONDS = 10 * 60;

export const getDocumentDownloadUrlTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_document_download_url",
  description:
    "Get a short-lived (10-minute) signed download/view link for one document. Use when the user asks to see, " +
    "open, or download a specific document. Every call is audit-logged, same as a human downloading it from the " +
    "UI.",
  inputSchema,
  scope: "read",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  async execute(ctx, input) {
    const { db, auth, runId } = ctx;
    assertUserAuth(auth);
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) {
      return { error: "Document management is not available for this tenant." };
    }

    const resolved = await assertDocumentVisible(db, auth, input.documentId);
    if (!resolved) return { error: "Document not found." };
    const { document } = resolved;

    if (!document.current_version_id) return { error: "Document has no available version." };

    const { data: versionData } = await db
      .from("applicant_document_versions")
      .select("*")
      .eq("id", document.current_version_id)
      .maybeSingle();
    const version = (versionData as unknown as ApplicantDocumentVersionRow | null) ?? null;
    if (!version) return { error: "Document has no available version." };

    let url: string;
    try {
      url = await getDocumentStorageProvider().createSignedDownloadUrl(version.storage_key, DOWNLOAD_URL_EXPIRY_SECONDS);
    } catch {
      return { error: "Failed to create a download link — please try again." };
    }

    await db.from("document_usage_events").insert({
      event_type: "download",
      resource_type: "applicant_document",
      resource_id: document.id,
      actor_user_id: auth.userId,
    });

    await Promise.all([
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "document.downloaded",
        entityType: "applicant_document",
        entityId: document.id,
        requestId: runId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: "document.downloaded",
        entityType: "applicant_document",
        entityId: document.id,
        requestId: runId,
      }),
    ]);

    return { url, expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS };
  },
};
