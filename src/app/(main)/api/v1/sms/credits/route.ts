import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

const RECENT_LEDGER_LIMIT = 20;

// GET /api/v1/sms/credits — balance, reserved, recent ledger rows.
export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/sms/credits" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const [{ data: account, error: accountError }, { data: ledger, error: ledgerError }] = await Promise.all([
    db.from("sms_credit_accounts").select("*").maybeSingle(),
    db.from("sms_credit_ledger").select("*").order("created_at", { ascending: false }).limit(RECENT_LEDGER_LIMIT),
  ]);

  if (accountError || ledgerError) {
    log.error({ err: accountError ?? ledgerError }, "Failed to load sms credits");
    return apiServiceUnavailable("Failed to load SMS credit account");
  }

  return apiSuccess({
    account: account ?? { balance: 0, reserved: 0, lifetime_granted: 0, lifetime_consumed: 0 },
    ledger: ledger ?? [],
  });
}
