import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface ApprovalRow {
  kind: "time_entry" | "milestone" | "change_request";
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  submittedAt: string;
  submittedByName?: string | null;
  detail: Record<string, unknown>;
}

interface ProjectEmbed {
  name: string | null;
  currency?: string | null;
}

function projectOf(embed: ProjectEmbed | ProjectEmbed[] | null): ProjectEmbed | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/approvals" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const [timeEntriesRes, milestonesRes, changeRequestsRes] = await Promise.all([
    db
      .from("time_entries")
      .select("id, user_id, project_id, entry_date, minutes, notes, projects(name)")
      .eq("approval_status", "pending")
      .order("entry_date", { ascending: true }),
    db
      .from("project_milestones")
      .select("id, project_id, title, amount, due_date, updated_at, projects(name, currency)")
      .eq("status", "submitted")
      .order("updated_at", { ascending: true }),
    db
      .from("project_change_requests")
      .select("id, project_id, title, classification, estimate_delta_minutes, budget_delta_amount, created_at, projects(name, currency)")
      .eq("status", "proposed")
      .order("created_at", { ascending: true }),
  ]);

  if (timeEntriesRes.error || milestonesRes.error || changeRequestsRes.error) {
    log.error(
      { timeEntriesError: timeEntriesRes.error, milestonesError: milestonesRes.error, changeRequestsError: changeRequestsRes.error },
      "Failed to fetch approvals"
    );
    return apiError("DB_ERROR", "Failed to fetch approvals", 500);
  }

  const rawTimeEntries = (timeEntriesRes.data ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    project_id: string;
    entry_date: string;
    minutes: number;
    notes: string | null;
    projects: ProjectEmbed | ProjectEmbed[] | null;
  }>;
  const rawMilestones = (milestonesRes.data ?? []) as unknown as Array<{
    id: string;
    project_id: string;
    title: string;
    amount: number | null;
    due_date: string | null;
    updated_at: string;
    projects: ProjectEmbed | ProjectEmbed[] | null;
  }>;
  const rawChangeRequests = (changeRequestsRes.data ?? []) as unknown as Array<{
    id: string;
    project_id: string;
    title: string;
    classification: string;
    estimate_delta_minutes: number;
    budget_delta_amount: number | null;
    created_at: string;
    projects: ProjectEmbed | ProjectEmbed[] | null;
  }>;

  // Resolve time-entry submitter names server-side (same auth.admin.listUsers
  // escape hatch as GET /api/v1/team) so the page doesn't need a second fetch.
  const nameMap = new Map<string, string | null>();
  if (rawTimeEntries.length > 0) {
    const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
    for (const u of authData?.users || []) {
      const meta = u.user_metadata as Record<string, unknown> | undefined;
      nameMap.set(u.id, ((meta?.name ?? meta?.full_name ?? u.email) as string | null) ?? null);
    }
  }

  const timeEntries: ApprovalRow[] = rawTimeEntries.map((e) => ({
    kind: "time_entry",
    id: e.id,
    projectId: e.project_id,
    projectName: projectOf(e.projects)?.name ?? "—",
    title: e.notes || "Time entry",
    submittedAt: e.entry_date,
    submittedByName: nameMap.get(e.user_id) ?? null,
    detail: { minutes: e.minutes, userId: e.user_id },
  }));

  const milestones: ApprovalRow[] = rawMilestones.map((m) => ({
    kind: "milestone",
    id: m.id,
    projectId: m.project_id,
    projectName: projectOf(m.projects)?.name ?? "—",
    title: m.title,
    submittedAt: m.updated_at,
    submittedByName: null,
    detail: { amount: m.amount, dueDate: m.due_date, currency: projectOf(m.projects)?.currency ?? "NPR" },
  }));

  const changeRequests: ApprovalRow[] = rawChangeRequests.map((c) => ({
    kind: "change_request",
    id: c.id,
    projectId: c.project_id,
    projectName: projectOf(c.projects)?.name ?? "—",
    title: c.title,
    submittedAt: c.created_at,
    submittedByName: null,
    detail: {
      classification: c.classification,
      estimateDeltaMinutes: c.estimate_delta_minutes,
      budgetDeltaAmount: c.budget_delta_amount,
      currency: projectOf(c.projects)?.currency ?? "NPR",
    },
  }));

  return apiSuccess({
    timeEntries,
    milestones,
    changeRequests,
    counts: {
      timeEntries: timeEntries.length,
      milestones: milestones.length,
      changeRequests: changeRequests.length,
      total: timeEntries.length + milestones.length + changeRequests.length,
    },
  });
}
