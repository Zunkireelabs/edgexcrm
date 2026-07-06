import { type NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiValidationError, apiConflict } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.AFFILIATES)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("affiliates")
    .select("id, name, ref_code, email, status, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch affiliates", 500);

  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.AFFILIATES)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { name?: string; ref_code?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  const name = (body.name ?? "").trim();
  const refCode = (body.ref_code ?? "").trim().toUpperCase();
  const email = (body.email ?? "").trim() || null;

  if (!name) return apiValidationError({ name: ["Name is required"] });
  if (!refCode) return apiValidationError({ ref_code: ["Ref code is required"] });
  if (/\s/.test(refCode)) return apiValidationError({ ref_code: ["Ref code must not contain spaces"] });

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("affiliates")
    .insert({ name, ref_code: refCode, email, status: "active" })
    .select("id, name, ref_code, email, status, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") return apiConflict("An affiliate with this ref code already exists");
    return apiError("DB_ERROR", "Failed to create affiliate", 500);
  }

  return apiSuccess(data, 201);
}
