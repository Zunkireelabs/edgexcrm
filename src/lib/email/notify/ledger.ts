import { logger } from "@/lib/logger";
import type { NotifyDb } from "./types";

/**
 * The exactly-once ledger behind dispatchNotificationEmail (table notification_email_log, migration 281).
 * Kept as its own tiny module so the SAME statements the dispatcher runs are what the database-backed test
 * (ledger.db.test.ts) exercises against real Postgres — they cannot drift apart.
 */

export interface LedgerKey {
  tenant_id: string;
  event: string;
  entity_id: string;
  recipient_email: string;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Claim the (event, entity, recipient) slot as 'pending'.
 *  - "claimed"   → we own it; go ahead and send.
 *  - "duplicate" → somebody already handled it (retry / double call / race); do NOT send.
 *  - "error"     → the ledger could not be written (e.g. table missing); do NOT send — fail closed.
 */
export async function claimLedgerRow(db: NotifyDb, key: LedgerKey): Promise<"claimed" | "duplicate" | "error"> {
  const { error } = await db.from("notification_email_log").insert({ ...key, status: "pending" });
  if (!error) return "claimed";
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return "duplicate";
  logger.error({ err: error, ...key }, "notify: could not write ledger row — NOT sending (fail closed)");
  return "error";
}

/** Move a claimed row to its final state. Only a provider-confirmed send may become 'sent'. */
export async function settleLedgerRow(
  db: NotifyDb,
  key: LedgerKey,
  patch: { status: "sent" | "failed"; error?: string | null; provider_message_id?: string | null }
): Promise<void> {
  const { error } = await db
    .from("notification_email_log")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", key.tenant_id)
    .eq("event", key.event)
    .eq("entity_id", key.entity_id)
    .eq("recipient_email", key.recipient_email);
  if (error) logger.error({ err: error, ...key }, "notify: could not update ledger row");
}
