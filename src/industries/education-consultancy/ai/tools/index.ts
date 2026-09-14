// Module-load registration point for the education_consultancy AI tool pack —
// imported (for its side effect) by src/lib/ai/tools/packs.ts so every industry
// pack is registered before buildToolset() is called. Mirrors the real_estate
// pack's index.ts: each tool declares `industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`
// so the registry auto-gates it out of every other tenant's toolset.
import { registerTool } from "@/lib/ai/tools/registry";
import { searchApplicationsTool } from "./search-applications";
import { getLeadApplicationsTool } from "./get-lead-applications";
import { applicationFunnelSummaryTool } from "./application-funnel-summary";
import { classEnrollmentSummaryTool } from "./class-enrollment-summary";
import { listApplicantDocumentsTool } from "./list-applicant-documents";
import { searchApplicantDocumentContentTool } from "./search-applicant-document-content";
import { getDocumentMetadataTool } from "./get-document-metadata";
import { getDocumentExtractedDataTool } from "./get-document-extracted-data";
import { findMissingDocumentsTool } from "./find-missing-documents";
import { getDocumentDownloadUrlTool } from "./get-document-download-url";

registerTool(searchApplicationsTool);
registerTool(getLeadApplicationsTool);
registerTool(applicationFunnelSummaryTool);
registerTool(classEnrollmentSummaryTool);
registerTool(listApplicantDocumentsTool);
registerTool(searchApplicantDocumentContentTool);
registerTool(getDocumentMetadataTool);
registerTool(getDocumentExtractedDataTool);
registerTool(findMissingDocumentsTool);
registerTool(getDocumentDownloadUrlTool);

export {
  searchApplicationsTool,
  getLeadApplicationsTool,
  applicationFunnelSummaryTool,
  classEnrollmentSummaryTool,
  listApplicantDocumentsTool,
  searchApplicantDocumentContentTool,
  getDocumentMetadataTool,
  getDocumentExtractedDataTool,
  findMissingDocumentsTool,
  getDocumentDownloadUrlTool,
};
