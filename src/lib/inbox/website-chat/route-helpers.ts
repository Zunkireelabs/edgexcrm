// What every website-chat route does first, and how a failure becomes a response. Shared by the settings route and
// the logo route so the rules (feature switch, admin only, tenant from the session) live in one place.

import { authenticateRequest, requireAdmin, type AuthContext } from "@/lib/api/auth";
import {
  apiConflict,
  apiForbidden,
  apiInternalError,
  apiNotFound,
  apiServiceUnavailable,
  apiUnauthorized,
} from "@/lib/api/response";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import { WebsiteChatError } from "./service";

export type Guard = { ok: true; auth: AuthContext; db: ScopedClient } | { ok: false; response: Response };

/** 404 unless INBOX_CHATWOOT_ENABLED=true, 401 when signed out, 403 unless owner/admin. The tenant comes from the session. */
export async function guard(): Promise<Guard> {
  if (process.env.INBOX_CHATWOOT_ENABLED !== "true") return { ok: false, response: apiNotFound("Website chat") };
  const auth = await authenticateRequest();
  if (!auth) return { ok: false, response: apiUnauthorized() };
  if (!requireAdmin(auth)) return { ok: false, response: apiForbidden("Only an owner or admin can manage website chat") };
  return { ok: true, auth, db: await scopedClient(auth) };
}

export function errorResponse(err: unknown) {
  if (err instanceof WebsiteChatError) {
    if (err.code === "already_connected") return apiConflict(err.message);
    if (err.code === "not_connected") return apiNotFound("Website chat");
    return apiServiceUnavailable(err.message);
  }
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "website chat route failed");
  return apiInternalError();
}
