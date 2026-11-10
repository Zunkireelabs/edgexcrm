import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { apiSuccess, apiUnauthorized, apiForbidden, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { countTags } from "@/lib/leads/tags";
import { getCachedTags, setCachedTags } from "@/lib/leads/tags-cache";

// EDGEX-127: distinct lead tags with lead counts for the bulk "Add tag" dialog. No migration: pages through the `tags`
// column in PostgREST-capped 1000-row chunks (only tagged rows). Same audience as the bulk route (admin/owner, or a
// team-scoped branch manager). Admins count the whole tenant; a branch manager counts leads in their branch or assigned to
// their branch's members (the same leads PATCH /leads/bulk will let them tag). Cached 60 s per tenant+scope.

const PAGE = 1000;
const MAX_PAGES = 20;

export async function GET() {
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: "/api/v1/leads/tags" });
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  const isAdmin = requireAdmin(auth);
  const isTeamScoped = auth.permissions.leadScope === "team" && auth.permissions.baseTier === "member";
  if (!isAdmin && !isTeamScoped) return apiForbidden();
  if (isTeamScoped && !auth.branchId) return apiForbidden();

  const scopeKey = isAdmin ? "all" : `branch:${auth.branchId}`;
  const key = `${auth.tenantId}:${scopeKey}`;
  const hit = getCachedTags(key);
  if (hit) return apiSuccess(hit);

  const db = await scopedClient(auth);
  const rows: Array<{ tags: string[] | null }> = [];
  let truncated = false;
  const started = Date.now();
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true;
      break;
    }
    let q = db
      .from("leads")
      .select("tags")
      .is("deleted_at", null)
      .is("converted_at", null)
      .not("tags", "is", null)
      .neq("tags", "{}")
      .order("id");
    if (!isAdmin) {
      const members = auth.branchMemberIds ?? [];
      q = members.length > 0 ? q.or(`branch_id.eq.${auth.branchId},assigned_to.in.(${members.join(",")})`) : q.eq("branch_id", auth.branchId as string);
    }
    const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      log.error({ err: error }, "Failed to load lead tags");
      return apiServiceUnavailable("Failed to load tags");
    }
    rows.push(...((data ?? []) as unknown as Array<{ tags: string[] | null }>));
    if ((data ?? []).length < PAGE) break;
  }
  log.info({ tenantId: auth.tenantId, rows: rows.length, ms: Date.now() - started, truncated }, "Lead tags counted");

  // Over the page budget the numbers would be incomplete: ship the names only, never a partial count.
  const body = {
    tags: countTags(rows).map((t) => ({ tag: t.tag, count: truncated ? null : t.count })),
    truncated,
  };
  setCachedTags(key, body);
  return apiSuccess(body);
}
