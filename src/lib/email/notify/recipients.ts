import { logger } from "@/lib/logger";
import type { NotifyDb, NotifyRecipient } from "./types";

/**
 * Who should receive an alert: every member of the tenant holding one of `roles`, with a real email address.
 * Generalises getTenantAdminRecipients() (src/lib/notifications.ts, which returns user ids only and is owner/admin
 * hard-coded). De-duplicated by lower-cased email; members without an email are skipped (logged, not thrown).
 * Removing a member deletes their tenant_users row (there is no "deactivated" state), so a role filter is enough.
 */
export async function resolveRecipients(
  db: NotifyDb,
  tenantId: string,
  roles: readonly string[]
): Promise<NotifyRecipient[]> {
  const { data, error } = await db
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("role", [...roles]);
  if (error) {
    logger.error({ err: error, tenantId }, "notify: could not load tenant members for recipients");
    return [];
  }

  const userIds = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  const looked = await Promise.all(
    userIds.map(async (userId): Promise<NotifyRecipient | null> => {
      try {
        const { data: res, error: userErr } = await db.auth.admin.getUserById(userId);
        const email = res?.user?.email?.trim().toLowerCase();
        if (userErr || !email) {
          logger.warn({ tenantId, userId, err: userErr }, "notify: recipient has no resolvable email, skipping");
          return null;
        }
        const meta = (res.user?.user_metadata ?? {}) as Record<string, unknown>;
        const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
        return { userId, email, name };
      } catch (err) {
        logger.warn({ err, tenantId, userId }, "notify: recipient lookup threw, skipping");
        return null;
      }
    })
  );

  const seen = new Set<string>();
  const out: NotifyRecipient[] = [];
  for (const r of looked) {
    if (!r || seen.has(r.email)) continue;
    seen.add(r.email);
    out.push(r);
  }
  return out;
}
