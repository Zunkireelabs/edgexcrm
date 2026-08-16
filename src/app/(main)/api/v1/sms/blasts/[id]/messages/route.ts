import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiPaginated, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/v1/sms/blasts/[id]/messages — paginated per-recipient rows.
// docs/SMS-PHASE4-BRIEF.md item 2: 3B's blast-detail.tsx shows aggregate
// counters only because 3A shipped no endpoint listing individual
// sms_messages rows for a blast. A blast can hold up to ~16,000 rows — this
// is exactly the "load the whole dataset per render" pattern the perf audit
// already flagged across six other pages, so it's paginated from day one.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/sms/blasts/[id]/messages" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: blast, error: blastError } = await db.from("sms_blasts").select("id").eq("id", id).maybeSingle();
  if (blastError || !blast) return apiNotFound("SMS blast");

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await db
    .from("sms_messages")
    .select(
      "id, lead_id, to_phone, status, error_code, error_message, provider_network, provider_status, delivered_at, sent_at, delivery_poll_attempts",
      { count: "exact" }
    )
    .eq("blast_id", id)
    .order("created_at", { ascending: true })
    .range(from, to);

  if (error) {
    log.error({ err: error, blastId: id }, "Failed to list sms blast recipient rows");
    return apiServiceUnavailable("Failed to list blast recipients");
  }

  const total = count ?? 0;
  return apiPaginated(data ?? [], { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}
