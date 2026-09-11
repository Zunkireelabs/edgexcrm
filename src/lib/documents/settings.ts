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
