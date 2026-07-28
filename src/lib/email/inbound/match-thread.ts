// Tenant-scoped thread matcher — promoted out of
// src/app/api/internal/email/poll/lib.ts (finding 4: the original was
// account-scoped only, so a Resend-inbound row — which has no connected
// account — could never use it). Shared by both lanes:
//   - Gmail poller: passes accountId + gmailThreadId for the primary exact
//     match, plus inReplyTo/references for the fallbacks.
//   - Resend-inbound processor: passes only tenantId + inReplyTo/references
//     (no connected account exists for edgex_native threads).
//
// Invariant (brief §8): tenantId is REQUIRED and filtered on in every query,
// including both the In-Reply-To and References fallbacks — a cross-tenant
// rfc_message_id collision must never resolve to another tenant's thread.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmailThreadRow {
  id: string;
  message_count: number;
  tenant_id: string;
  lead_id: string | null;
  contact_id: string | null;
  gmail_thread_id: string | null;
  connected_email_account_id: string | null;
}

const THREAD_COLUMNS =
  "id, message_count, tenant_id, lead_id, contact_id, gmail_thread_id, connected_email_account_id";

export interface MatchThreadParams {
  tenantId: string;
  /** Gmail lane only — the primary exact-match branch requires both to be set. */
  accountId?: string;
  gmailThreadId?: string;
  inReplyTo?: string | null;
  references?: string[];
}

export async function matchInboundToThread(
  supabase: SupabaseClient,
  params: MatchThreadParams,
): Promise<EmailThreadRow | null> {
  const { tenantId, accountId, gmailThreadId, inReplyTo, references = [] } = params;

  // Primary: exact Gmail threadId match (Gmail-to-Gmail). Only attempted when
  // the caller supplies connected-account context — Resend-inbound callers
  // never do, and fall straight through to the RFC fallbacks below.
  if (accountId && gmailThreadId) {
    const { data: byThreadId } = await supabase
      .from("email_threads")
      .select(THREAD_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("connected_email_account_id", accountId)
      .eq("gmail_thread_id", gmailThreadId)
      .maybeSingle();
    if (byThreadId) return byThreadId as EmailThreadRow;
  }

  // Fallback 1: RFC In-Reply-To header (vendor-independent)
  if (inReplyTo) {
    const thread = await findThreadByRfcMessageId(supabase, tenantId, accountId, inReplyTo);
    if (thread) return thread;
  }

  // Fallback 2: References chain, most specific (last) first
  for (const refId of [...references].reverse()) {
    const thread = await findThreadByRfcMessageId(supabase, tenantId, accountId, refId);
    if (thread) return thread;
  }

  return null;
}

async function findThreadByRfcMessageId(
  supabase: SupabaseClient,
  tenantId: string,
  accountId: string | undefined,
  rfcMessageId: string,
): Promise<EmailThreadRow | null> {
  let emailQuery = supabase
    .from("emails")
    .select("thread_id")
    .eq("tenant_id", tenantId)
    .eq("rfc_message_id", rfcMessageId);
  if (accountId) {
    emailQuery = emailQuery.eq("connected_email_account_id", accountId);
  }

  const { data: parentEmail } = await emailQuery.maybeSingle();
  if (!parentEmail) return null;

  const { data: thread } = await supabase
    .from("email_threads")
    .select(THREAD_COLUMNS)
    .eq("id", (parentEmail as { thread_id: string }).thread_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return (thread as EmailThreadRow | null) ?? null;
}
