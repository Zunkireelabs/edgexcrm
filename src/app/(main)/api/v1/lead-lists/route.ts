import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canAccessList, leadQueryScope } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { createRequestLogger } from "@/lib/logger";
import { sharedBranchLeadIdsForAssignee } from "@/lib/leads/branch-membership";
import type { LeadList } from "@/types/database";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateAccess(access: unknown): string | null {
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    return "access must be an object";
  }
  const a = access as Record<string, unknown>;
  if (a.mode !== "all" && a.mode !== "allow") {
    return 'access.mode must be "all" or "allow"';
  }
  if (a.mode === "allow") {
    if (!Array.isArray(a.positionIds) || a.positionIds.some((p) => typeof p !== "string")) {
      return "access.positionIds must be an array of strings";
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/lead-lists" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: lists, error } = await supabase
    .from("lead_lists")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .order("sort_order", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch lead lists");
    return apiServiceUnavailable("Failed to fetch lead lists");
  }

  // Filter by per-list access
  const accessible = (lists as LeadList[]).filter((l) =>
    canAccessList(auth.permissions, l.access as { mode: string; positionIds?: string[] }, auth.positionId, l.id)
  );

  // Count leads per list, respecting caller's lead scope
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
  let countQuery = supabase
    .from("leads")
    .select("list_id", { count: "exact" })
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .is("converted_at", null)
    .not("list_id", "is", null);

  if (scope.restrictToSelf) {
    // Inline column filter — avoids .in("id", 500+ uuids) URL overflow.
    const sharedIds = await sharedBranchLeadIdsForAssignee(supabase, auth.tenantId, auth.userId);
    if (sharedIds.length > 0) {
      countQuery = countQuery.or(`assigned_to.eq.${auth.userId},id.in.(${sharedIds.join(",")})`);
    } else {
      countQuery = countQuery.eq("assigned_to", auth.userId);
    }
  } else if (scope.branchId) {
    countQuery = countQuery.in("assigned_to", auth.branchMemberIds);
  }

  const { data: countRows } = await countQuery.select("list_id");
  const countMap: Record<string, number> = {};
  for (const row of countRows ?? []) {
    if (row.list_id) {
      countMap[row.list_id] = (countMap[row.list_id] ?? 0) + 1;
    }
  }

  const result = accessible.map((l) => ({ ...l, count: countMap[l.id] ?? 0 }));
  log.info({ total: result.length }, "Lead lists fetched");
  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/lead-lists" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const name = (body.name as string | undefined)?.trim();
  if (!name) return apiValidationError({ name: ["name is required"] });

  const accessVal = body.access ?? { mode: "all" };
  const accessErr = validateAccess(accessVal);
  if (accessErr) return apiValidationError({ access: [accessErr] });

  const db = await scopedClient(auth);
  const supabase = await createServiceClient();

  // Unique slug
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const { data: existing } = await supabase
      .from("lead_lists")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  const { data: created, error } = await db
    .from("lead_lists")
    .insert({
      name,
      slug,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 99,
      color: (body.color as string | null) ?? null,
      access: accessVal,
      is_system: false,
      is_archive: body.is_archive === true,
      is_intake: false,
    })
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to create lead list");
    return apiServiceUnavailable("Failed to create lead list");
  }

  log.info({ listId: (created as LeadList).id }, "Lead list created");
  return apiSuccess(created as LeadList, 201);
}
