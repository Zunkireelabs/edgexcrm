import type { ScopedClient } from "@/lib/supabase/scoped";
import { DOCUMENT_MAX_FILE_BYTES_DEFAULT } from "./constants";

// No row is required per tenant (migration 231) — falls back to the same
// 25MB default the column itself defaults to when a settings row exists.
export async function loadMaxDocumentSizeBytes(db: ScopedClient): Promise<number> {
  const { data } = await db.from("tenant_document_settings").select("max_document_size_mb").maybeSingle();
  const row = data as unknown as { max_document_size_mb: number } | null;
  const mb = row?.max_document_size_mb;
  return typeof mb === "number" && mb > 0 ? mb * 1024 * 1024 : DOCUMENT_MAX_FILE_BYTES_DEFAULT;
}

// Phase 6 quotas — unlike max_document_size_mb, these two columns have no
// column default (migration 231: max_storage_bytes/max_documents_per_lead
// are both nullable, no DEFAULT). null means "no row, or no cap configured"
// — unlimited, not zero. Callers must treat null as "skip the check", never
// as "0 allowed".
export async function loadStorageQuotaBytes(db: ScopedClient): Promise<number | null> {
  const { data } = await db.from("tenant_document_settings").select("max_storage_bytes").maybeSingle();
  const row = data as unknown as { max_storage_bytes: number | null } | null;
  return row?.max_storage_bytes ?? null;
}

export async function loadMaxDocumentsPerLead(db: ScopedClient): Promise<number | null> {
  const { data } = await db.from("tenant_document_settings").select("max_documents_per_lead").maybeSingle();
  const row = data as unknown as { max_documents_per_lead: number | null } | null;
  return row?.max_documents_per_lead ?? null;
}
