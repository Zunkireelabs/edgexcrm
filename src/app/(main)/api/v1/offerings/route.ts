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
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  OFFERING_STATUSES,
  OFFERING_STRUCTURES,
  OFFERING_EXEMPTIONS,
  equityRaised,
  type Offering,
  type InvestorCommitment,
} from "@/industries/real-estate/lib/commitments";

// GET /api/v1/offerings — list offerings with computed raise metrics.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: offeringsData, error } = await db
    .from("offerings")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch offerings", 500);
  const offerings = (offeringsData ?? []) as unknown as Offering[];

  // Pull all live commitments for the tenant once, aggregate per offering in JS.
  const { data: commitmentsData } = await db
    .from("investor_commitments")
    .select("offering_id, status, amount")
    .is("deleted_at", null);
  const commitments = (commitmentsData ?? []) as unknown as Pick<
    InvestorCommitment,
    "offering_id" | "status" | "amount"
  >[];

  const byOffering = new Map<string, Pick<InvestorCommitment, "status" | "amount">[]>();
  for (const c of commitments) {
    const arr = byOffering.get(c.offering_id) ?? [];
    arr.push({ status: c.status, amount: c.amount });
    byOffering.set(c.offering_id, arr);
  }

  const enriched = offerings.map((o) => {
    const rows = byOffering.get(o.id) ?? [];
    return {
      ...o,
      equity_raised: equityRaised(rows),
      investor_count: rows.filter((r) => r.status !== "declined").length,
      funded_count: rows.filter((r) => r.status === "funded").length,
    };
  });

  return apiSuccess(enriched);
}

// POST /api/v1/offerings — create a capital-raise vehicle (admin only).
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/offerings" });

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

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const insert: Record<string, unknown> = {
    name: String(body.name).trim(),
    created_by: auth.userId,
  };

  if (body.slug) insert.slug = String(body.slug).trim();
  if (body.asset_class) insert.asset_class = String(body.asset_class).trim();
  if (body.description) insert.description = String(body.description);
  if (body.currency) insert.currency = String(body.currency);
  if (body.close_date) insert.close_date = String(body.close_date);

  if (body.structure !== undefined && body.structure !== null && body.structure !== "") {
    if (!OFFERING_STRUCTURES.includes(body.structure as never)) {
      return apiValidationError({ structure: [`Must be one of: ${OFFERING_STRUCTURES.join(", ")}`] });
    }
    insert.structure = body.structure;
  }
  if (body.exemption !== undefined && body.exemption !== null && body.exemption !== "") {
    if (!OFFERING_EXEMPTIONS.includes(body.exemption as never)) {
      return apiValidationError({ exemption: [`Must be one of: ${OFFERING_EXEMPTIONS.join(", ")}`] });
    }
    insert.exemption = body.exemption;
  }
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!OFFERING_STATUSES.includes(body.status as never)) {
      return apiValidationError({ status: [`Must be one of: ${OFFERING_STATUSES.join(", ")}`] });
    }
    insert.status = body.status;
  }

  for (const numField of ["target_raise", "min_investment", "pref_return"]) {
    if (body[numField] !== undefined && body[numField] !== null && body[numField] !== "") {
      const n = Number(body[numField]);
      if (!Number.isFinite(n) || n < 0) {
        return apiValidationError({ [numField]: ["Must be a non-negative number"] });
      }
      insert[numField] = n;
    }
  }

  const db = await scopedClient(auth);
  const { data: created, error } = await db
    .from("offerings")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    log.error({ error }, "Failed to create offering");
    return apiError("DB_ERROR", "Failed to create offering", 500);
  }

  log.info({ offeringId: (created as { id: string }).id }, "Offering created");
  return apiSuccess(created, 201);
}
