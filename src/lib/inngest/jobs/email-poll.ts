import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { pollOneAccount } from "@/app/api/internal/email/poll/lib";
import { emailMeta } from "@/industries/_shared/features/email/meta";
import type { ConnectedEmailAccount } from "@/types/database";

const CONCURRENCY = 5;

// Cross-tenant service-role scan (a background cron has no single tenant) — this module lives
// under src/lib/inngest/, same justification as src/lib/inngest/jobs/reminders.ts. Extracted
// verbatim from the email-poll HTTP route's post-auth body so the GH-cron route and the Inngest
// ops-email-poll function share one implementation.
export async function runEmailPoll(): Promise<{
  disabled?: boolean;
  accounts_polled: number;
  new_inbound_count: number;
  errors: number;
}> {
  // Path A: inbound reply-sync requires the restricted gmail.readonly scope
  // (+ CASA), which we don't ship yet. Keep the poller dormant until Path B.
  // Flip EMAIL_REPLY_SYNC_ENABLED=true (and restore the readonly scope) then.
  if (process.env.EMAIL_REPLY_SYNC_ENABLED !== "true") {
    return { disabled: true, accounts_polled: 0, new_inbound_count: 0, errors: 0 };
  }

  const supabase = await createServiceClient();

  // Load connected accounts for tenants whose industry the email feature is
  // actually registered for (emailMeta.industries — the same list the
  // feature gate itself checks), not a hardcoded single industry. This was
  // previously hardcoded to "education_consultancy" only, so when the email
  // feature was later opened to travel_agency tenants too, their accounts
  // could connect and send but were silently never polled for replies.
  const { data: accounts, error: accountsErr } = await supabase
    .from("connected_email_accounts")
    .select("*, tenants!inner(industry_id)")
    .in("tenants.industry_id", [...emailMeta.industries])
    .order("created_at");

  if (accountsErr) {
    logger.error({ err: accountsErr }, "Failed to load connected_email_accounts for polling");
    return { accounts_polled: 0, new_inbound_count: 0, errors: 1 };
  }

  if (!accounts || accounts.length === 0) {
    return { accounts_polled: 0, new_inbound_count: 0, errors: 0 };
  }

  let totalNewInbound = 0;
  let totalErrors = 0;

  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const chunk = accounts.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((account) => pollOneAccount(supabase, account as ConnectedEmailAccount)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        totalNewInbound += r.value.newInboundCount;
      } else {
        totalErrors += 1;
      }
    }
  }

  return {
    accounts_polled: accounts.length,
    new_inbound_count: totalNewInbound,
    errors: totalErrors,
  };
}
