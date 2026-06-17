import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import type { Branch } from "@/types/database";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data, error } = await db.from("branches").select("*").order("sort_order");

  if (error) return apiServiceUnavailable("Failed to fetch branches");
  return apiSuccess((data ?? []) as unknown as Branch[]);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/branches" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return apiValidationError({ name: ["Name is required"] });
  if (name.length > 120) return apiValidationError({ name: ["Name must be 120 characters or fewer"] });

  const slug = typeof body.slug === "string" && body.slug.trim()
    ? body.slug.trim()
    : slugify(name);
  if (!slug) return apiValidationError({ slug: ["Could not derive a valid slug from name"] });

  const sortOrder =
    typeof body.sort_order === "number" ? body.sort_order : 0;

  const managerUserId =
    typeof body.manager_user_id === "string" && UUID_REGEX.test(body.manager_user_id)
      ? body.manager_user_id
      : null;

  const db = await scopedClient(auth);

  // Entitlement gate: count existing branches before creating a new one
  const { count, error: countError } = await db
    .from("branches")
    .select("*", { count: "exact", head: true });

  if (countError) return apiServiceUnavailable("Failed to check branch count");

  const maxBranches = auth.entitlements.maxBranches;
  if ((count ?? 0) >= maxBranches) {
    return apiError(
      "PLAN_LIMIT",
      "Branch limit reached for your plan. Upgrade to Enterprise to add more branches.",
      403,
    );
  }

  const { data, error } = await db
    .from("branches")
    .insert({ name, slug, sort_order: sortOrder, manager_user_id: managerUserId })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ slug: ["A branch with this slug already exists"] });
    }
    log.error({ err: error }, "Failed to create branch");
    return apiServiceUnavailable("Failed to create branch");
  }

  log.info({ branchId: (data as Branch).id }, "Branch created");
  return apiSuccess(data as Branch, 201);
}
