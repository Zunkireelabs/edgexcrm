import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  OFFERING_STATUSES,
  OFFERING_STRUCTURES,
  OFFERING_EXEMPTIONS,
} from "@/industries/real-estate/lib/commitments";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("offerings")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch offering", 500);
  if (!data) return apiNotFound("Offering");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/offerings/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return apiValidationError({ name: ["Name is required"] });
    const lenErr = maxLength(255)(name);
    if (lenErr) return apiValidationError({ name: [lenErr] });
    update.name = name;
  }
  for (const textField of ["slug", "asset_class", "description", "currency", "close_date"]) {
    if (body[textField] !== undefined) {
      update[textField] = body[textField] === null || body[textField] === ""
        ? null
        : String(body[textField]);
    }
  }
  if (body.structure !== undefined) {
    if (body.structure === null || body.structure === "") update.structure = null;
    else if (!OFFERING_STRUCTURES.includes(body.structure as never)) {
      return apiValidationError({ structure: [`Must be one of: ${OFFERING_STRUCTURES.join(", ")}`] });
    } else update.structure = body.structure;
  }
  if (body.exemption !== undefined) {
    if (body.exemption === null || body.exemption === "") update.exemption = null;
    else if (!OFFERING_EXEMPTIONS.includes(body.exemption as never)) {
      return apiValidationError({ exemption: [`Must be one of: ${OFFERING_EXEMPTIONS.join(", ")}`] });
    } else update.exemption = body.exemption;
  }
  if (body.status !== undefined) {
    if (!OFFERING_STATUSES.includes(body.status as never)) {
      return apiValidationError({ status: [`Must be one of: ${OFFERING_STATUSES.join(", ")}`] });
    }
    update.status = body.status;
  }
  for (const numField of ["target_raise", "min_investment", "pref_return"]) {
    if (body[numField] !== undefined) {
      if (body[numField] === null || body[numField] === "") {
        update[numField] = null;
      } else {
        const n = Number(body[numField]);
        if (!Number.isFinite(n) || n < 0) {
          return apiValidationError({ [numField]: ["Must be a non-negative number"] });
        }
        update[numField] = n;
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return apiValidationError({ _: ["No valid fields to update"] });
  }

  const db = await scopedClient(auth);
  // Explicit id filter beyond the auto-injected tenant filter (scopedClient rule).
  const { data, error } = await db
    .from("offerings")
    .update(update)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    log.error({ error }, "Failed to update offering");
    return apiError("DB_ERROR", "Failed to update offering", 500);
  }
  if (!data) return apiNotFound("Offering");
  return apiSuccess(data);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  // Soft delete. Explicit id filter beyond the auto-injected tenant filter.
  const { data, error } = await db
    .from("offerings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to delete offering", 500);
  if (!data) return apiNotFound("Offering");
  return apiSuccess({ id: (data as { id: string }).id, deleted: true });
}
