import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiPaginated, apiValidationError, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { toProviderRecipient, providerMsisdnToE164 } from "@/lib/sms/phone";
import { suppressPhone } from "@/lib/sms/suppression";
import { createRequestLogger } from "@/lib/logger";

// GET /api/v1/sms/suppressions — paginated manual DNC list.
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/sms/suppressions" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await db
    .from("sms_suppressions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    log.error({ err: error }, "Failed to list sms suppressions");
    return apiServiceUnavailable("Failed to list SMS suppressions");
  }

  const total = count ?? 0;
  return apiPaginated(data ?? [], { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

// POST /api/v1/sms/suppressions — manual DNC add. reason='manual', source='admin'.
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/suppressions" });

  const guard = await requireSmsAccess({ requireSend: true });
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return apiValidationError({ body: ["Request body must be a JSON object"] });
  const b = body as Record<string, unknown>;

  const { valid, errors } = validate(b, { phone: [required("phone")] });
  if (!valid) return apiValidationError(errors);

  const parsed = toProviderRecipient(typeof b.phone === "string" ? b.phone : null);
  if (!parsed.ok) {
    return apiValidationError({ phone: [`Not a suppressible Nepal mobile number (${parsed.reason})`] });
  }

  try {
    await suppressPhone(db, auth.tenantId, {
      phoneE164: providerMsisdnToE164(parsed.msisdn),
      reason: "manual",
      source: "admin",
      leadId: typeof b.leadId === "string" ? b.leadId : null,
      createdBy: auth.userId,
      note: typeof b.note === "string" ? b.note : null,
    });
  } catch (err) {
    log.error({ err }, "Failed to add sms suppression");
    return apiServiceUnavailable("Failed to add suppression");
  }

  return apiSuccess({ phoneE164: providerMsisdnToE164(parsed.msisdn) }, 201);
}

// DELETE /api/v1/sms/suppressions?id=<uuid> — remove a manual DNC entry.
export async function DELETE(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: "/api/v1/sms/suppressions" });

  const guard = await requireSmsAccess({ requireSend: true });
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return apiValidationError({ id: ["id query param is required"] });

  const { data: existing, error: fetchError } = await db.from("sms_suppressions").select("id").eq("id", id).maybeSingle();
  if (fetchError || !existing) return apiNotFound("Suppression");

  const { error } = await db.from("sms_suppressions").delete().eq("id", id);
  if (error) {
    log.error({ err: error }, "Failed to remove sms suppression");
    return apiServiceUnavailable("Failed to remove suppression");
  }

  return apiSuccess({ removed: true });
}
