import { z } from "zod";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { requireLeadBranchAccess } from "@/lib/api/auth";
import type { AgentTool } from "../types";
import { resolveLeadVisibilityPlan, applyLeadVisibilityPlan, getLeadMembership, isLeadCollaborator } from "./lib/lead-visibility";

const inputSchema = z.object({
  leadId: z.string().uuid().optional().describe("Omit for tenant-wide recent activity, scoped to leads the caller can see"),
  limit: z.number().int().min(1).max(50).default(50),
});

export const activityTimelineTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "activity_timeline",
  description:
    "Recent logged activities (calls, emails, meetings). Pass leadId for one lead's history, or omit for " +
    "a tenant-wide recent-activity feed scoped to what the caller can see.",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db, auth } = ctx;

    if (input.leadId) {
      const { data: lead } = await db
        .from("leads")
        .select("id, assigned_to, branch_id")
        .eq("id", input.leadId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!lead) return { error: "Lead not found." };
      const leadRow = lead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

      const membership = await getLeadMembership(db, input.leadId);
      const isAssignee = membership.some((m) => m.assigned_to === auth.userId) || leadRow.assigned_to === auth.userId;
      if (shouldRestrictToSelf(auth.permissions) && !isAssignee && !(await isLeadCollaborator(db, input.leadId, auth.userId))) {
        return { error: "Lead not found." };
      }
      if (!requireLeadBranchAccess(auth, leadRow, membership)) return { error: "Lead not found." };

      const { data, error } = await db
        .from("lead_activities")
        .select("id, activity_type, subject, description, call_outcome, created_at, user_id")
        .eq("lead_id", input.leadId)
        .order("created_at", { ascending: false })
        .limit(input.limit);
      if (error) return { error: "Failed to fetch activities." };

      return { leadId: input.leadId, href: `/leads/${input.leadId}`, activities: data ?? [] };
    }

    // Tenant-wide: all-scope callers see every activity; own/team-scope callers
    // are capped to activity on leads they can currently see.
    if (auth.permissions.leadScope === "all") {
      const { data, error } = await db
        .from("lead_activities")
        .select("id, lead_id, activity_type, subject, description, call_outcome, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(input.limit);
      if (error) return { error: "Failed to fetch activity." };
      const rows = (data ?? []) as unknown as Array<{ lead_id: string; [key: string]: unknown }>;
      return { activities: rows.map((a) => ({ ...a, href: `/leads/${a.lead_id}` })) };
    }

    let leadsQuery = db.from("leads").select("id").is("deleted_at", null);
    const visibilityPlan = await resolveLeadVisibilityPlan(db, auth, null);
    leadsQuery = applyLeadVisibilityPlan(leadsQuery, visibilityPlan, auth);
    const { data: visibleLeads } = await leadsQuery.limit(300);
    const leadIds = ((visibleLeads ?? []) as unknown as Array<{ id: string }>).map((l) => l.id);
    if (leadIds.length === 0) return { activities: [] };

    const { data, error } = await db
      .from("lead_activities")
      .select("id, lead_id, activity_type, subject, description, call_outcome, created_at, user_id")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false })
      .limit(input.limit);
    if (error) return { error: "Failed to fetch activity." };

    const rows = (data ?? []) as unknown as Array<{ lead_id: string; [key: string]: unknown }>;
    return { activities: rows.map((a) => ({ ...a, href: `/leads/${a.lead_id}` })) };
  },
};
