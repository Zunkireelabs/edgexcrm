// GET /api/v1/inbox/pending-claims
// Website chats waiting to be accepted RIGHT NOW (a visitor wrote recently and nobody owns the chat). Feeds the app-wide
// "New website chat" pop-up: on load, every 30 seconds, and whenever the live feed fires. Rules: src/lib/inbox/claim-rules.ts.

import { authenticateRequest } from "@/lib/api/auth";
import { canSeeNav } from "@/lib/api/permissions";
import { apiUnauthorized, apiForbidden, apiSuccess } from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";
import { CLAIM_PROVIDERS, OWNERLESS_FILTER, POPUP_WINDOW_HOURS } from "@/lib/inbox/claim-rules";
import { readNeedsHuman } from "@/lib/inbox/ai-reply/config";

const MAX_CARDS = 20;
// Read more than we show: chats the AI is handling are filtered in code below, after the database filters.
const FETCH_ROWS = 60;

interface PendingRow {
  id: string;
  contact_display_name: string | null;
  contact_phone: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_message_direction: string | null;
  ai_autonomy: string | null;
  meta: unknown;
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  // Everyone who can open the Inbox sees waiting chats (that is what lets the first free person take one).
  if (!canSeeNav(auth.permissions, "/inbox")) return apiForbidden();

  const supabase = await createServiceClient();
  const since = new Date(Date.now() - POPUP_WINDOW_HOURS * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, contact_display_name, contact_phone, last_message_preview, last_message_at, last_message_direction, ai_autonomy, meta")
    .eq("tenant_id", auth.tenantId)
    .eq("status", "open")
    .in("provider", [...CLAIM_PROVIDERS])
    .or(OWNERLESS_FILTER)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(FETCH_ROWS);

  if (error) return apiSuccess([]);

  // Still waiting for a PERSON when the visitor spoke last, or when the AI is the one answering (its replies make the last
  // message "outbound", but nobody human has taken the chat) or has handed it over. A chat a teammate answered has an owner
  // and is already filtered out above.
  const cards = ((data ?? []) as PendingRow[])
    .filter((r) => r.last_message_direction === "inbound" || r.ai_autonomy === "autonomous" || readNeedsHuman(r.meta) !== null)
    .map((r) => ({
      id: r.id,
      contact_display_name: r.contact_display_name,
      contact_phone: r.contact_phone,
      last_message_preview: r.last_message_preview,
      last_message_at: r.last_message_at,
      ai_replying: r.ai_autonomy === "autonomous",
      needs_human: readNeedsHuman(r.meta) !== null,
    }))
    // Chats that need a person first, then newest.
    .sort((a, b) => Number(b.needs_human) - Number(a.needs_human))
    .slice(0, MAX_CARDS);
  return apiSuccess(cards);
}
