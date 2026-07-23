import { z } from "zod";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import type { AgentTool } from "../types";
import { canViewLead } from "./lib/lead-visibility";
import { leadDisplayName, leadHref } from "./lib/format";
import { optionalUuid } from "./lib/sanitize";

const inputSchema = z.object({
  // leadId is required in the tool's contract (there's no sane default), but a
  // NIL-uuid placeholder must still surface as a normal "missing" validation
  // error rather than silently querying the all-zero id.
  leadId: optionalUuid(z.string().uuid()).describe("The lead's id (as returned by search_leads)"),
});

export const getLeadTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "get_lead",
  description:
    "Get full detail on one lead: contact fields, stage/list, assignee, recent activity, open tasks, " +
    "and applications (if the industry tracks them). Use after search_leads to look at a specific lead " +
    "the user asked about.",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db, auth } = ctx;
    assertUserAuth(auth);

    const { data: lead } = await db.from("leads").select("*").eq("id", input.leadId).is("deleted_at", null).maybeSingle();
    if (!lead) return { error: "Lead not found." };

    const leadRow = lead as unknown as {
      id: string;
      assigned_to: string | null;
      branch_id: string | null;
      pipeline_id: string;
      list_id: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      status: string | null;
      city: string | null;
      country: string | null;
      tags: string[] | null;
      created_at: string;
      last_activity_at: string | null;
    };

    const visible = await canViewLead(db, auth, leadRow);
    if (!visible) return { error: "Lead not found." };

    type ActivityRow = { id: string; activity_type: string; subject: string | null; description: string | null; call_outcome: string | null; created_at: string; user_id: string };
    type TaskRow = { id: string; title: string; status: string; priority: string; due_date: string | null };
    type ApplicationRow = { id: string; university_name: string; program_name: string; status: string; application_deadline: string | null };

    const [activities, tasks, applications] = await Promise.all([
      db
        .from("lead_activities")
        .select("id, activity_type, subject, description, call_outcome, created_at, user_id")
        .eq("lead_id", input.leadId)
        .order("created_at", { ascending: false })
        .limit(10),
      db
        .from("tasks")
        .select("id, title, status, priority, due_date")
        .eq("lead_id", input.leadId)
        .order("created_at", { ascending: false })
        .limit(10),
      db
        .from("applications")
        .select("id, university_name, program_name, status, application_deadline")
        .eq("lead_id", input.leadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    return {
      id: leadRow.id,
      href: leadHref(leadRow.id),
      name: leadDisplayName(leadRow),
      email: leadRow.email,
      phone: leadRow.phone,
      city: leadRow.city,
      country: leadRow.country,
      stage: leadRow.status,
      pipelineId: leadRow.pipeline_id,
      listId: leadRow.list_id,
      assignedTo: leadRow.assigned_to,
      tags: leadRow.tags ?? [],
      createdAt: leadRow.created_at,
      lastActivityAt: leadRow.last_activity_at,
      recentActivities: ((activities.data ?? []) as unknown as ActivityRow[]).map((a) => ({
        id: a.id,
        type: a.activity_type,
        subject: a.subject,
        description: a.description,
        callOutcome: a.call_outcome,
        createdAt: a.created_at,
        userId: a.user_id,
      })),
      tasks: ((tasks.data ?? []) as unknown as TaskRow[]).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
      })),
      applications: ((applications.data ?? []) as unknown as ApplicationRow[]).map((a) => ({
        id: a.id,
        university: a.university_name,
        program: a.program_name,
        status: a.status,
        deadline: a.application_deadline,
      })),
    };
  },
};
