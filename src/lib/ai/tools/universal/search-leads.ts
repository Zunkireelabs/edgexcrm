import { z } from "zod";
import { canAccessList, leadQueryScope, isSharedPoolList } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { AgentTool } from "../types";
import { resolveLeadVisibilityPlan, applyLeadVisibilityPlan } from "./lib/lead-visibility";
import { formatLeadRow } from "./lib/format";
import { optionalFilterString, optionalString, optionalUuid } from "./lib/sanitize";

const DISPLAY_ID_RE = /^[A-Z]{2,5}-\d+$/i;

const inputSchema = z.object({
  query: optionalString(z.string().max(200).optional()).describe(
    "Free-text search across first name, last name, email, phone, and display id (e.g. \"ADM-009\") — a token " +
      "shaped like a display id matches it exactly, so pass the id staff actually use rather than guessing a uuid.",
  ),
  stage: optionalFilterString(z.string().max(100).optional()).describe(
    "Pipeline stage slug, e.g. \"qualified\" or \"new\". Omit entirely to include all — never pass \"all\".",
  ),
  list: optionalFilterString(z.string().max(100).optional()).describe(
    "Lead list slug (shown as \"Stage\" in the UI), e.g. \"prospects\". Omit entirely to include all — never pass \"all\".",
  ),
  assignedToUserId: optionalUuid(z.string().uuid().optional()).describe("Filter to a specific teammate's leads by their user id (ignored for own-scope callers)"),
  createdAfter: optionalString(z.string().max(40).optional()).describe(
    "ISO date/datetime — only leads created on/after this. Only use when the user explicitly asks about a time window.",
  ),
  createdBefore: optionalString(z.string().max(40).optional()).describe(
    "ISO date/datetime — only leads created on/before this. Only use when the user explicitly asks about a time window.",
  ),
  limit: z.number().int().min(1).max(20).default(20),
});

export const searchLeadsTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "search_leads",
  description:
    "Search the tenant's leads by name/email/phone, stage, list, assignee, or creation date range. " +
    "Results are automatically scoped to what the current user can see (own leads / branch / all). " +
    "Use this before answering any question about specific leads or counts of leads matching a filter.",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { auth, db } = ctx;

    let resolvedListId: string | null = null;
    let archiveListIds: string[] = [];
    if (getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)) {
      const { data: lists } = await db.from("lead_lists").select("id, slug, is_archive, access");
      const listRows = (lists ?? []) as unknown as Array<{ id: string; slug: string; is_archive: boolean; access: unknown }>;
      archiveListIds = listRows.filter((l) => l.is_archive).map((l) => l.id);
      if (input.list) {
        const targetList = listRows.find((l) => l.slug === input.list);
        if (!targetList) {
          return { total: 0, leads: [], note: `No stage/list named "${input.list}".` };
        }
        const accessible = canAccessList(
          auth.permissions,
          targetList.access as { mode: string; positionIds?: string[] },
          auth.positionId,
          targetList.id,
        );
        if (!accessible) return { total: 0, leads: [], note: "You don't have access to that stage." };
        resolvedListId = targetList.id;
      }
    }

    let query = db
      .from("leads")
      .select(
        "id, display_id, first_name, last_name, email, phone, status, stage_id, pipeline_id, list_id, assigned_to, created_at, last_activity_at, tags",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .is("converted_at", null)
      .not("tags", "cs", '{"other"}');

    if (resolvedListId) {
      query = query.eq("list_id", resolvedListId);
    } else if (archiveListIds.length > 0) {
      query = query.or(`list_id.is.null,list_id.not.in.(${archiveListIds.join(",")})`);
    }

    const visibilityPlan = await resolveLeadVisibilityPlan(db, auth, resolvedListId);
    query = applyLeadVisibilityPlan(query, visibilityPlan, auth);

    // Mirrors GET /api/v1/leads: own-scope (and shared-pool) callers cannot widen
    // to another assignee — an explicit assignedToUserId is ignored for them.
    const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
    const ignoresAssigneeFilter = scope.restrictToSelf || (!!auth.branchId && isSharedPoolList(auth.permissions, resolvedListId));
    if (input.assignedToUserId && !ignoresAssigneeFilter) {
      query = query.eq("assigned_to", input.assignedToUserId);
    }

    if (input.stage) query = query.eq("status", input.stage);
    if (input.createdAfter) query = query.gte("created_at", input.createdAfter);
    if (input.createdBefore) query = query.lte("created_at", input.createdBefore);

    if (input.query) {
      const sanitized = input.query.replace(/[,().]/g, "");
      // Split into tokens so a full-name query ("Sarah Chen") matches — no single
      // column holds the full name. Each token gets its own .or() group; chained
      // .or() calls AND together in PostgREST, so every token must match somewhere.
      // Diverges from GET /api/v1/leads, which still does single-string matching.
      const tokens = sanitized.split(/\s+/).filter(Boolean).slice(0, 4);
      for (const token of tokens) {
        // A display-id-shaped token (e.g. "ADM-009") is an unambiguous identifier —
        // match it exactly against display_id instead of competing with the fuzzy
        // name/email/phone columns, which would never match it anyway.
        query = DISPLAY_ID_RE.test(token)
          ? query.or(`display_id.ilike.${token}`)
          : query.or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%,email.ilike.%${token}%,phone.ilike.%${token}%`);
      }
    }

    const { data, error, count } = await query.order("last_activity_at", { ascending: false }).limit(input.limit);
    if (error) return { error: "Failed to search leads." };

    return {
      total: count ?? 0,
      leads: (data ?? []).map(formatLeadRow),
    };
  },
};
