// Phase 6 quota enforcement (docs/APPLICANT-DOCUMENTS-STATUS.md §3, Phase 6).
// Read-only usage aggregation, computed at read time rather than maintained
// as a mutable counter — same "no mutable counter" design principle as
// document_usage_events itself (see migration 231's header note).
//
// Deliberately does NOT use a PostgREST `!inner` resource-embed to join
// applicant_document_versions -> applicant_documents in one query: migration
// 195 revoked broad SELECT grants from `authenticated`, and an embed join
// needs its own GRANT migration per table (see this repo's CLAUDE.md
// "pitfalls that keep biting" note) — adding one is explicitly out of scope
// here (no DB changes in this phase). Two plain per-table queries, summed in
// application code, avoids the grant requirement entirely.
import type { ScopedClient } from "@/lib/supabase/scoped";

/**
 * Total bytes currently sitting in R2 for this tenant's live (non-deleted)
 * documents — summed across EVERY version of each document, not just the
 * current one. Old versions are never deleted on replace (only a full
 * document delete purges them, see documents/[id]/route.ts), so their bytes
 * are still real storage usage even though `applicant_documents.file_size`
 * only reflects the current version.
 */
export async function getTenantStorageUsedBytes(db: ScopedClient): Promise<number> {
  const { data: liveDocs } = await db.from("applicant_documents").select("id").is("deleted_at", null);
  const docIds = ((liveDocs ?? []) as unknown as Array<{ id: string }>).map((d) => d.id);
  if (docIds.length === 0) return 0;

  const { data: versions } = await db.from("applicant_document_versions").select("file_size").in("document_id", docIds);
  return ((versions ?? []) as unknown as Array<{ file_size: number }>).reduce((sum, v) => sum + v.file_size, 0);
}

/** Count of live (non-deleted) documents for one lead — for the per-lead document-count cap. */
export async function getLeadDocumentCount(db: ScopedClient, leadId: string): Promise<number> {
  const { count } = await db
    .from("applicant_documents")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .is("deleted_at", null);
  return count ?? 0;
}
