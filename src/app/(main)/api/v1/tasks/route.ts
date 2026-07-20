import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiPaginated,
  apiUnauthorized,
  apiForbidden,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { dueFilterToDateRange, type DueDateRange } from "@/industries/it-agency/features/project-board/lib/due-keywords";
import { todayInTz } from "@/lib/hr/dates";

const VALID_STATUSES = ["todo", "in_progress", "done"];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/tasks" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();

  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") ?? "50", 10) || 50));

  // Counselor defense-in-depth: force assignee_id to own userId
  let assigneeId = searchParams.get("assignee_id") ?? undefined;
  if (shouldRestrictToSelf(auth.permissions)) {
    assigneeId = auth.userId;
  }

  const projectId = searchParams.get("project_id") ?? undefined;
  const accountId = searchParams.get("account_id") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const dueKeyword = searchParams.get("due") ?? undefined;

  const rawStatus = searchParams.get("status");
  const statuses = rawStatus
    ? rawStatus.split(",").filter((s) => VALID_STATUSES.includes(s))
    : [];

  const rawPriority = searchParams.get("priority");
  const priorities = rawPriority
    ? rawPriority.split(",").filter((p) => VALID_PRIORITIES.includes(p))
    : [];

  const rawTags = searchParams.get("tags");
  const tags = rawTags ? rawTags.split(",").filter(Boolean) : [];

  const db = await scopedClient(auth);

  // If account_id filter is set, resolve project IDs for that account first
  let accountProjectIds: string[] | undefined;
  if (accountId) {
    const { data: accountProjects } = await db
      .from("projects")
      .select("id")
      .eq("account_id", accountId);
    accountProjectIds = (accountProjects ?? []).map((p) => (p as unknown as { id: string }).id);
    // If the account has no projects, no tasks can match
    if (accountProjectIds.length === 0) {
      return apiPaginated([], { page, pageSize, total: 0, totalPages: 0 });
    }
  }

  let query = db
    .from("tasks")
    .select("*, projects(id, name, account_id, accounts(id, name))", { count: "exact" });

  query = query.not("project_id", "is", null);

  if (projectId) query = query.eq("project_id", projectId);
  if (accountProjectIds) query = query.in("project_id", accountProjectIds);
  if (assigneeId) query = query.eq("assignee_id", assigneeId);
  if (statuses.length > 0) query = query.in("status", statuses);
  if (priorities.length > 0) query = query.in("priority", priorities);
  if (tags.length > 0) query = query.overlaps("tags", tags);

  if (q) {
    const sanitized = q.replace(/[,().]/g, "");
    if (sanitized) query = query.ilike("title", `%${sanitized}%`);
  }

  let due: DueDateRange | null = null;
  if (dueKeyword && dueKeyword !== "__all__") {
    const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
    const timezone = (tenantRow as { timezone: string } | null)?.timezone ?? "Asia/Kathmandu";
    due = dueFilterToDateRange(dueKeyword, todayInTz(timezone));
  }
  if (due) {
    if (due.isNull) {
      query = query.is("due_date", null);
    } else {
      // overdue: IS NOT NULL implied (to without from)
      if (due.from) query = query.gte("due_date", due.from);
      if (due.to) query = query.lte("due_date", due.to);
      // For overdue, we also need IS NOT NULL
      if (dueKeyword === "overdue") query = query.not("due_date", "is", null);
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    log.error({ error }, "Failed to fetch tasks");
    return apiError("DB_ERROR", "Failed to fetch tasks", 500);
  }

  const total = count ?? 0;
  log.info({ total, page, pageSize }, "Tasks fetched");

  return apiPaginated(data ?? [], { page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
}
