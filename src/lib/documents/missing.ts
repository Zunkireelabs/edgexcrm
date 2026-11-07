import type { DocumentType } from "./constants";

/**
 * The ONE definition of "which required documents are still missing" for a lead: the tenant's required list
 * (`tenant_document_settings.required_document_types`) minus the distinct types already on file
 * (`applicant_documents`, not deleted). Used by the `find_missing_documents` AI tool and the education Home.
 *
 * An empty required list means completeness CAN'T be assessed (`assessable: false`), not "nothing is missing".
 */
export function computeMissingDocuments(
  required: readonly DocumentType[] | null | undefined,
  uploadedTypes: Iterable<string>,
): { assessable: boolean; missing: DocumentType[] } {
  const list = required ?? [];
  if (list.length === 0) return { assessable: false, missing: [] };
  const have = new Set(uploadedTypes);
  return { assessable: true, missing: list.filter((t) => !have.has(t)) };
}
