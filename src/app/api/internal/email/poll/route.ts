import { createServiceClient } from "@/lib/supabase/server";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { pollOneAccount } from "./lib";
import { emailMeta } from "@/industries/_shared/features/email/meta";
import type { ConnectedEmailAccount } from "@/types/database";

const CONCURRENCY = 5;

export async function POST(request: Request) {
  // Fail-closed: if env var is unset, reject ALL requests (no bearer is ever valid)
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) {
    logger.error("INTERNAL_CRON_SECRET env var is not set — rejecting poll request");
    return apiUnauthorized();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return apiUnauthorized();
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
    return apiSuccess({ accounts_polled: 0, new_inbound_count: 0, errors: 1 });
  }

  if (!accounts || accounts.length === 0) {
    return apiSuccess({ accounts_polled: 0, new_inbound_count: 0, errors: 0 });
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

  return apiSuccess({
    accounts_polled: accounts.length,
    new_inbound_count: totalNewInbound,
    errors: totalErrors,
  });
}
