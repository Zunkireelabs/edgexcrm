import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";

const EDUCATION = "education_consultancy";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.industryId !== EDUCATION) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("lead_types")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to load lead types", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/lead-types" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.industryId !== EDUCATION) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    label: [required("label"), maxLength(60)],
  });
  if (!valid) return apiValidationError(errors);

  const label = String(body.label).trim();
  let slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return apiValidationError({ label: ["Label must contain alphanumerics"] });

  const db = await scopedClient(auth);

  // Make slug unique within tenant
  const { data: clash } = await db.from("lead_types").select("id").eq("slug", slug).maybeSingle();
  if (clash) {
    let n = 2;
    while (true) {
      const candidate = `${slug}-${n}`;
      const { data: c } = await db.from("lead_types").select("id").eq("slug", candidate).maybeSingle();
      if (!c) { slug = candidate; break; }
      n += 1;
    }
  }

  // Place at end
  const { data: maxRowRaw } = await db
    .from("lead_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const maxRow = maxRowRaw as unknown as { sort_order: number } | null;
  const sortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data: created, error } = await db
    .from("lead_types")
    .insert({ slug, label, sort_order: sortOrder, is_default: false })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create lead type");
    return apiError("DB_ERROR", "Failed to create lead type", 500);
  }

  return apiSuccess(created, 201);
}
