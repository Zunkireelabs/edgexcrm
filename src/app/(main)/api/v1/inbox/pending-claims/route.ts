// GET /api/v1/inbox/pending-claims
// Website chats waiting to be accepted RIGHT NOW (a visitor wrote recently and nobody owns the chat). Feeds the app-wide
// "New website chat" pop-up: on load, every 30 seconds, and whenever the live feed fires. Rules: src/lib/inbox/claim-rules.ts.

import { authenticateRequest } from "@/lib/api/auth";
import { canSeeNav } from "@/lib/api/permissions";
import { apiUnauthorized, apiForbidden, apiSuccess } from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";
import { CLAIM_PROVIDERS, OWNERLESS_FILTER, POPUP_WINDOW_HOURS } from "@/lib/inbox/claim-rules";

const MAX_CARDS = 20;

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  // Everyone who can open the Inbox sees waiting chats (that is what lets the first free person take one).
  if (!canSeeNav(auth.permissions, "/inbox")) return apiForbidden();

  const supabase = await createServiceClient();
  const since = new Date(Date.now() - POPUP_WINDOW_HOURS * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, contact_display_name, contact_phone, last_message_preview, last_message_at")
    .eq("tenant_id", auth.tenantId)
    .eq("status", "open")
    .in("provider", [...CLAIM_PROVIDERS])
    .or(OWNERLESS_FILTER)
    // The visitor is the last one who spoke, and recently: a chat a teammate already answered doesn't need a pop-up.
    .eq("last_message_direction", "inbound")
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(MAX_CARDS);

  if (error) return apiSuccess([]);
  return apiSuccess(data ?? []);
}
