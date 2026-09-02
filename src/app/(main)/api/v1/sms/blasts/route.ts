import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiPaginated, apiSuccess, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { validate, required, optionalMaxLength } from "@/lib/api/validation";
import { filterTreeSchema } from "@/lib/filters/schema";
import { EMPTY_TREE } from "@/lib/filters/types";
import { createRequestLogger } from "@/lib/logger";

// GET /api/v1/sms/blasts — paginated list.
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/sms/blasts" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await db
    .from("sms_blasts")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    log.error({ err: error }, "Failed to list sms blasts");
    return apiServiceUnavailable("Failed to list SMS blasts");
  }

  const total = count ?? 0;
  return apiPaginated(data ?? [], { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

// POST /api/v1/sms/blasts — create a draft. Write access (canSendSms) — a
// draft is inert until /send, but only reps trusted to send should be able
// to stage one.
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/blasts" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return apiValidationError({ body: ["Request body must be a JSON object"] });

  const { valid, errors } = validate(body as Record<string, unknown>, {
    name: [required("name"), optionalMaxLength(200)],
    body: [required("body"), optionalMaxLength(1200)],
  });
  if (!valid) return apiValidationError(errors);

  const audienceFilterRaw = (body as Record<string, unknown>).audience_filter ?? EMPTY_TREE;
  const parsed = filterTreeSchema.safeParse(audienceFilterRaw);
  if (!parsed.success) {
    return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
  }

  const { data, error } = await db
    .from("sms_blasts")
    .insert({
      name: (body as Record<string, unknown>).name,
      body: (body as Record<string, unknown>).body,
      audience_filter: parsed.data,
      status: "draft",
      created_by: auth.userId,
    })
    .select("*")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to create sms blast");
    return apiServiceUnavailable("Failed to create SMS blast");
  }

  return apiSuccess(data, 201);
}
