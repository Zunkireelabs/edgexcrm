import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiPaginated, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/v1/email-blasts/[id]/messages — paginated per-recipient rows.
// Mirrors sms/blasts/[id]/messages: a blast can hold up to ~16,000 rows, so
// paginated from day one rather than the "load the whole dataset per render"
// pattern the perf audit already flagged elsewhere.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/email-blasts/[id]/messages" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: blast, error: blastError } = await db.from("email_blasts").select("id").eq("id", id).maybeSingle();
  if (blastError || !blast) return apiNotFound("Email blast");

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await db
    .from("email_messages")
    .select("id, lead_id, to_email, status, error_code, error_message, sent_at, delivered_at, bounced_at", { count: "exact" })
    .eq("source", "blast")
    .eq("source_id", id)
    .order("created_at", { ascending: true })
    .range(from, to);

  if (error) {
    log.error({ err: error, blastId: id }, "Failed to list email blast recipient rows");
    return apiServiceUnavailable("Failed to list blast recipients");
  }

  const total = count ?? 0;
  return apiPaginated(data ?? [], { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}
