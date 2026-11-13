import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiSuccess, apiUnauthorized } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getCurrentTenantTimezone } from "@/industries/education-consultancy/features/application-tracking/lib/tenant-timezone";
import { resolveApplicationsScope } from "@/industries/education-consultancy/features/application-tracking/lib/applications-scope";
import { loadBoardMeta, loadBoardSlice } from "@/industries/education-consultancy/features/application-tracking/lib/board-load";
import { COLUMN_PAGE_SIZE, LIST_MAX_PAGE_SIZE, LIST_PAGE_SIZE } from "@/industries/education-consultancy/features/application-tracking/lib/board-index";
import type { CompileCtx } from "@/lib/filters/types";

// GET /api/v1/applications/board-page (EDGEX-141 Phase 3, B4): the next page of one board column
// (?stage=) or of the flat list (no stage), from the SAME URL state the board page renders
// (f, q, sort, tab, pipeline). The server rebuilds the index with the same scope helper every time;
// the client never sends ids. Params: offset (>= 0), limit (default 25; 1..50 for a column,
// 1..100 for the list, Phase 4). List responses also carry the footer `summary` over the whole
// filtered index (computed from the same index, no extra query).

const MAX_OFFSET = 1_000_000;

function intParam(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const url = new URL(request.url);
  const offset = intParam(url.searchParams.get("offset"), 0);
  if (offset === null || offset > MAX_OFFSET) return apiError("BAD_REQUEST", "offset must be a whole number of 0 or more", 400);
  const stage = url.searchParams.get("stage");
  const maxLimit = stage ? LIST_PAGE_SIZE : LIST_MAX_PAGE_SIZE;
  const limit = intParam(url.searchParams.get("limit"), COLUMN_PAGE_SIZE);
  if (limit === null || limit < 1 || limit > maxLimit) return apiError("BAD_REQUEST", `limit must be between 1 and ${maxLimit}`, 400);

  const supabase = await createServiceClient();
  const userClient = await createClient();
  const [resolved, meta, tz] = await Promise.all([
    resolveApplicationsScope({ user: userClient, service: supabase }, auth),
    loadBoardMeta(supabase, auth.tenantId),
    getCurrentTenantTimezone(supabase, auth.tenantId),
  ]);
  if (resolved.error) {
    console.error("[applications/board-page] own-scope lead visibility query failed", { tenantId: auth.tenantId, userId: auth.userId, error: resolved.error });
  }

  const ctx: CompileCtx = { tz, now: new Date(), industryId: auth.industryId, permissions: {} };
  const params: Record<string, string> = {};
  for (const k of ["f", "q", "sort", "tab", "pipeline"]) {
    const v = url.searchParams.get(k);
    if (v !== null) params[k] = v;
  }
  const res = await loadBoardSlice({
    supabase, tenantId: auth.tenantId, userId: auth.userId, scope: resolved.scope, ctx, params, meta, stage, offset, limit,
  });
  if (!res.ok) return apiError(res.status === 400 ? "BAD_REQUEST" : "DB_ERROR", res.message, res.status);

  return apiSuccess({
    cards: res.cards,
    total: res.total,
    hasMore: res.hasMore,
    offset,
    truncated: res.truncated,
    filterError: res.filterError,
    summary: res.summary,
  });
}
