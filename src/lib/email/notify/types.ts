import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reusable "notification email" building blocks. An alert (new lead, lead assigned, consent signed, …) is ONE
 * small event definition; the layout, recipient lookup, per-recipient send, de-duplication ledger and failure
 * logging are shared. See ./dispatch.ts and ./events/new-lead.ts for the worked example.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotifyDb = SupabaseClient<any>;

export interface NotifyRecipient {
  userId: string;
  /** Lower-cased, de-duplicated. */
  email: string;
  name: string | null;
}

export interface NotifyTenant {
  id: string;
  name: string;
  primaryColor: string;
  /** IANA zone (tenants.timezone). Times in emails are shown in it; falls back to UTC. */
  timezone: string;
}

export interface NotifyMessage {
  subject: string;
  html: string;
  /** Plain-text alternative — improves deliverability and is what some clients show first. */
  text: string;
}

/**
 * P = what the caller hands over (plain data, no route/request types).
 * C = what `prepare` learned from the DB that `build` needs (e.g. the intake list's name).
 */
export interface NotificationEmailEvent<P, C = undefined> {
  /** Stable key, stored in the ledger. Never rename a shipped event id (it would re-send history). */
  id: string;
  /** Tenant roles that receive this alert (tenant_users.role). */
  roles: readonly string[];
  tenantId(payload: P): string;
  /** The thing the alert is about (lead id, …). With `id` + recipient this is the de-duplication key. */
  entityId(payload: P): string;
  /** Return `null` when this occurrence should NOT notify anyone; otherwise whatever `build` needs. */
  prepare(payload: P, db: NotifyDb): Promise<C | null>;
  build(args: { payload: P; context: C; tenant: NotifyTenant; recipient: NotifyRecipient }): NotifyMessage;
}

export interface DispatchSummary {
  /** Why nothing was sent, when applicable. */
  skipped?: "not_eligible" | "no_tenant" | "no_recipients" | "email_not_configured" | "error";
  sent: number;
  failed: number;
  /** Recipients the ledger said were already handled (retries, double calls, races). */
  duplicates: number;
}
