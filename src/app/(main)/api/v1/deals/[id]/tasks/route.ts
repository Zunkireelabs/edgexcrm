import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { resolveUserNames } from "@/lib/supabase/queries";

interface Props {
  params: Promise<{ id: string }>;
}

interface TaskRow {
  id: string;
  assignee_id: string | null;
  assigned_by_id: string | null;
  [key: string]: unknown;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id: dealId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  // Verify deal belongs to this tenant
  const { data: deal } = await db.from("deals").select("id").eq("id", dealId).maybeSingle();
  if (!deal) return apiNotFound("Deal");

  const { data: tasks, error } = await db
    .from("tasks")
    .select("*, leads(id, first_name, last_name), projects(id, name)")
    .eq("deal_id", dealId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch tasks", 500);

  const rows = (tasks ?? []) as unknown as TaskRow[];
  const userIds = new Set<string>();
  for (const t of rows) {
    if (t.assignee_id) userIds.add(t.assignee_id);
    if (t.assigned_by_id) userIds.add(t.assigned_by_id);
  }
  const nameMap = await resolveUserNames(Array.from(userIds));

  const enriched = rows.map((t) => ({
    ...t,
    assignee_name: t.assignee_id ? nameMap.get(t.assignee_id) ?? null : null,
    assigned_by_name: t.assigned_by_id ? nameMap.get(t.assigned_by_id) ?? null : null,
  }));

  return apiSuccess(enriched);
}
