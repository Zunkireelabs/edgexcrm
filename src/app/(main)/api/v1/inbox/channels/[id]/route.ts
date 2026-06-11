// DELETE /api/v1/inbox/channels/[id] — remove a channel (admin only; cascades conversations + messages)

import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiNotFound,
  apiInternalError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const { id } = await params;

  const db = await scopedClient(auth);

  // Verify the channel exists + belongs to this tenant before deleting
  const { data: existing } = await db
    .from("inbox_channels")
    .select("id, provider, display_name")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Channel");

  const { error } = await db.from("inbox_channels").delete().eq("id", id);

  if (error) return apiInternalError();

  return apiSuccess({ deleted: true });
}
