import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getStorageProvider } from "@/lib/storage/provider";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data: item } = await db
    .from("knowledge_base_items")
    .select("type, storage_path, file_name")
    .eq("id", itemId)
    .single();

  if (!item) return apiNotFound("Knowledge base item");

  const row = item as unknown as { type: string; storage_path?: string | null; file_name?: string | null };
  if (row.type !== "file" || !row.storage_path) {
    return apiNotFound("Knowledge base item");
  }

  let url: string;
  try {
    url = await getStorageProvider().getSignedDownloadUrl("knowledge-base-files", row.storage_path, 60);
  } catch {
    return apiError("STORAGE_ERROR", "Failed to create download URL", 500);
  }

  return apiSuccess({ url });
}
