// Resolves a human-readable display name to wrap the Reply-To token in
// (docs/email-productionization/SLICE-A-GUARD-REPLYTO-FIX-BRIEF.md §2). A bare
// `reply+l<40 hex chars>@lead-crm.zunkireelabs.com` in a lead's To: chip reads
// as phishing — Gmail only renders the address when there's no name to show.
//
// Presentational only. The token itself is never touched here: the reply path
// has no sender guard (unlike the BCC dropbox path), so the 144-bit token is
// the only thing preventing forged inbound history.

import type { ScopedClient } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";

/**
 * Strips CR/LF, quotes, backslashes, and angle brackets (header-injection
 * vector — the label ultimately comes from user-controllable data), collapses
 * whitespace, and caps length. Returns null (never "") for input that reduces
 * to nothing usable.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\r\n"\\<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}

export interface ResolveReplyToLabelParams {
  /** connected_email_accounts.display_name — skipped if email-shaped (see below). */
  accountDisplayName: string | null;
  userId: string;
  tenantId: string;
}

/**
 * First usable value wins:
 *   1. account.display_name, but ONLY if it does not contain "@". The OAuth
 *      callback sets display_name: email at connect time
 *      (inboxes/callback/route.ts), so this is almost always email-shaped and
 *      must be skipped — a display name that is an email address different
 *      from the actual sending address is precisely the shape anti-spoofing
 *      heuristics flag, worse than the raw token.
 *   2. The sending user's name: auth.admin.getUserById → user_metadata.name
 *      ?? user_metadata.full_name (canonical name source, see
 *      api/v1/team/route.ts).
 *   3. The tenant's name (via raw() — tenants has no tenant_id column, so
 *      scopedClient's auto-injected filter would error on it).
 *   4. Nothing usable → null (caller falls back to the bare token address).
 *
 * Never throws — every step is wrapped in one try/catch so a lookup hiccup
 * degrades to "no label" instead of taking down the send. Callers must still
 * invoke this from inside their own guarded block (do not add I/O elsewhere)
 * per the brief; this internal catch is a second, independent safety net.
 */
export async function resolveReplyToLabel(
  db: ScopedClient,
  params: ResolveReplyToLabelParams,
): Promise<string | null> {
  try {
    if (params.accountDisplayName && !params.accountDisplayName.includes("@")) {
      const fromAccount = sanitizeDisplayName(params.accountDisplayName);
      if (fromAccount) return fromAccount;
    }

    const { data: userRes } = await db.raw().auth.admin.getUserById(params.userId);
    const meta = userRes?.user?.user_metadata as Record<string, unknown> | undefined;
    const userName = sanitizeDisplayName(
      (meta?.name ?? meta?.full_name ?? null) as string | null | undefined,
    );
    if (userName) return userName;

    const { data: tenantRow } = await db
      .raw()
      .from("tenants")
      .select("name")
      .eq("id", params.tenantId)
      .maybeSingle<{ name: string | null }>();
    return sanitizeDisplayName(tenantRow?.name ?? null);
  } catch (err) {
    logger.warn({ err }, "Reply-To display-name resolution failed — falling back to bare token address");
    return null;
  }
}
