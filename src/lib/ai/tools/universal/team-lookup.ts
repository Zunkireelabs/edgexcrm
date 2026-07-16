import { z } from "zod";
import { canSeeNav } from "@/lib/api/permissions";
import type { AgentTool } from "../types";
import { optionalString } from "./lib/sanitize";

const inputSchema = z.object({
  query: optionalString(z.string().max(200).optional()).describe("Filter by name or email substring"),
  limit: z.number().int().min(1).max(50).default(50),
});

export const teamLookupTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "team_lookup",
  description:
    "List teammates: name, email, role, position, branch. Use to resolve a name the user mentions to a " +
    "user id (e.g. before filtering search_leads/list_my_tasks by assignee), or to answer roster questions.",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db, auth } = ctx;

    if (!canSeeNav(auth.permissions, "/team") && !auth.permissions.canAssignLeads) {
      return { error: "You don't have access to the team roster." };
    }

    const { data: membersRaw } = await db
      .from("tenant_users")
      .select("user_id, role, position_id, branch_id, positions(name, slug)")
      .limit(200);

    // Sanctioned exception to the "no raw() in src/lib/ai/" rule: emails/names only
    // exist in auth.users, and auth.admin.listUsers() is the one escape hatch
    // scoped.ts itself documents for this exact case (mirrors GET /api/v1/team).
    const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
    const emailById = new Map<string, string>();
    const nameById = new Map<string, string | null>();
    for (const u of authData?.users ?? []) {
      emailById.set(u.id, u.email || "");
      const meta = u.user_metadata as Record<string, unknown> | undefined;
      nameById.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
    }

    const { data: branches } = await db.from("branches").select("id, name");
    const branchNameById = new Map(((branches ?? []) as unknown as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]));

    const members = ((membersRaw ?? []) as unknown as Array<{
      user_id: string;
      role: string;
      position_id: string | null;
      branch_id: string | null;
      positions: { name: string | null; slug: string | null } | { name: string | null; slug: string | null }[] | null;
    }>).map((m) => {
      const positionEmbed = Array.isArray(m.positions) ? (m.positions[0] ?? null) : m.positions;
      const email = emailById.get(m.user_id) || "";
      const name = nameById.get(m.user_id) || email || "Unknown";
      return {
        userId: m.user_id,
        name,
        email,
        role: m.role,
        position: positionEmbed?.name ?? null,
        branch: m.branch_id ? branchNameById.get(m.branch_id) ?? null : null,
      };
    });

    const q = input.query?.trim().toLowerCase();
    const filtered = q
      ? members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      : members;

    return { members: filtered.slice(0, input.limit) };
  },
};
