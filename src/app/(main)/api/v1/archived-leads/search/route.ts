import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { getTeamMembers } from "@/lib/supabase/queries";
import { buildIlikeOrFilter } from "@/lib/api/search-filter";
import { createRequestLogger } from "@/lib/logger";
import type { ArchivedLeadPreview } from "@/industries/education-consultancy/features/archived-lookup/lib/types";
import { canOpenLead } from "@/industries/education-consultancy/features/archived-lookup/lib/access";

// GET /api/v1/archived-leads/search?q=<name | email | phone>
//
// Finds leads that sit in an ARCHIVE stage so they can be found from Global Search (client request, Oct 2026: a
// counselor must be able to look up an archived lead and send it back to the pipeline).
//
// DELIBERATE EXCEPTION to own-scope lead scoping — the same one the office Check-In search (/api/v1/leads/check-in) has
// always made: the search is NOT limited to the caller's own leads, because the whole point is finding a lead that was
// archived under someone else. To keep that safe it returns only a small SUMMARY (name, contact, why/when archived,
// original stage, assigned counselor) — never notes, documents or activity, which stay behind the lead page's own
// access rules — needs at least 3 characters, and returns at most 5 rows. Tenant-scoped, education-only.

const MIN_QUERY = 3;
const MAX_RESULTS = 5;
const MAX_TOKENS = 4;
const SEARCH_COLUMNS = ["first_name", "last_name", "email", "phone"] as const;

interface ArchivedRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  assigned_to: string | null;
  archive_reason: string | null;
  archived_at: string | null;
  archived_from_list_id: string | null;
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/archived-leads/search" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ARCHIVED_LOOKUP)) return apiForbidden();

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY) {
    return apiValidationError({ q: [`Query must be at least ${MIN_QUERY} characters`] });
  }

  // Each space-separated word must match one of the columns ("john smith" finds first=John + last=Smith).
  const filters = q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS)
    .map((token) => buildIlikeOrFilter(SEARCH_COLUMNS, token))
    .filter((f): f is string => !!f);
  if (filters.length === 0) {
    return apiValidationError({ q: [`Query must be at least ${MIN_QUERY} characters`] });
  }

  const db = await scopedClient(auth);

  let query = db
    .from("leads")
    .select(
      `id, first_name, last_name, email, phone, created_at, assigned_to,
       archive_reason, archived_at, archived_from_list_id,
       lead_lists!leads_list_id_fkey!inner(is_archive)`,
    )
    .eq("lead_lists.is_archive", true)
    .is("deleted_at", null)
    .is("converted_at", null);
  for (const f of filters) query = query.or(f);

  const { data, error } = await query
    .order("archived_at", { ascending: false, nullsFirst: false })
    .limit(MAX_RESULTS);

  if (error) {
    log.error({ err: error }, "Failed to search archived leads");
    return apiServiceUnavailable("Failed to search archived leads");
  }

  const rows = (data ?? []) as unknown as ArchivedRow[];

  // Human-readable names: the assigned counselor and the stage each lead was archived from.
  const originIds = [...new Set(rows.map((r) => r.archived_from_list_id).filter((id): id is string => !!id))];
  const [team, origins] = await Promise.all([
    rows.some((r) => r.assigned_to) ? getTeamMembers(auth.tenantId) : Promise.resolve([]),
    originIds.length > 0
      ? db.from("lead_lists").select("id, name").in("id", originIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const nameByUser = new Map(team.map((m) => [m.user_id, m.name] as const));
  const listNameById = new Map(
    ((origins.data ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name] as const),
  );

  const canRestore = auth.permissions.canEditLeads;
  const results: ArchivedLeadPreview[] = rows.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    archive_reason: r.archive_reason,
    archived_at: r.archived_at,
    archived_from_list_name: r.archived_from_list_id ? (listNameById.get(r.archived_from_list_id) ?? null) : null,
    assigned_to_name: r.assigned_to ? (nameByUser.get(r.assigned_to) ?? null) : null,
    created_at: r.created_at,
    can_open: canOpenLead(auth, r),
    can_restore: canRestore,
  }));

  return apiSuccess(results);
}
