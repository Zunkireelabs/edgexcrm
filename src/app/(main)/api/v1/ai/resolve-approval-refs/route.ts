import { NextRequest } from "next/server";
import { isAssistantEnabled } from "@/lib/ai/flag";
import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiNotFound, apiValidationError } from "@/lib/api/response";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";
import { UNDOABLE_TOOL_IDS } from "@/lib/ai/tools/universal/undo-lead-action";
import { canViewLead } from "@/lib/ai/tools/universal/lib/lead-visibility";
import {
  ENTITY_REF_KINDS,
  refKey,
  leadLabel,
  assigneeLabel,
  formatRelativeTime,
  buildUndoDescription,
  type EntityRef,
  type EntityRefKind,
  type ResolvedRef,
} from "@/lib/ai/tools/universal/lib/approval-resolve";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REFS = 25;

function isValidRef(v: unknown): v is EntityRef {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.kind !== "string" || !(ENTITY_REF_KINDS as readonly string[]).includes(r.kind)) return false;
  if (r.id !== null && (typeof r.id !== "string" || !UUID_RE.test(r.id))) return false;
  return true;
}

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_id: string | null;
  assigned_to: string | null;
  branch_id: string | null;
  pipeline_id: string;
  list_id: string | null;
}

/**
 * Tenant-scoped AND lead-scope-aware: returns null if the lead doesn't exist,
 * belongs to another tenant, OR the caller isn't permitted to see it (a
 * counselor's own-scope restriction, branch scope, pipeline access — the same
 * `canViewLead` oracle `get_lead` uses). Deliberately collapses all three
 * cases to the same null/notFound outcome — a distinct "no permission"
 * response would confirm the lead exists, which is the leak in a thinner
 * form (BRIEF-PHASE-4D-FIXUP finding 1).
 */
async function fetchLeadLabel(db: ScopedClient, auth: AuthContext, id: string): Promise<string | null> {
  const { data } = await db
    .from("leads")
    .select("id, first_name, last_name, display_id, assigned_to, branch_id, pipeline_id, list_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const lead = data as unknown as LeadRow;
  const visible = await canViewLead(db, auth, lead);
  if (!visible) return null;
  return leadLabel(lead);
}

/**
 * Tenant-scoped: a user id only resolves if it's a member of THIS tenant
 * (`tenant_users` check first) — auth.admin.getUserById() itself has no
 * tenant concept (Supabase Auth users are shared across the project), so
 * skipping the membership check would let an id belonging to another
 * tenant's user resolve to that user's real name. This is the exact
 * cross-tenant leak BRIEF-PHASE-4D calls out as the case that matters.
 */
async function fetchAssigneeLabel(db: ScopedClient, id: string): Promise<string | null> {
  const { data: member } = await db.from("tenant_users").select("user_id").eq("user_id", id).maybeSingle();
  if (!member) return null;

  const { data } = await db.raw().auth.admin.getUserById(id);
  const user = data?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = (meta.name ?? meta.full_name ?? null) as string | null;
  return assigneeLabel(name, user?.email ?? null);
}

async function resolveLead(db: ScopedClient, auth: AuthContext, id: string): Promise<ResolvedRef> {
  const label = await fetchLeadLabel(db, auth, id);
  return label ? { label } : { notFound: true };
}

async function resolveAssignee(db: ScopedClient, id: string): Promise<ResolvedRef> {
  const label = await fetchAssigneeLabel(db, id);
  return label ? { label } : { notFound: true };
}

async function resolveKnowledgeBase(db: ScopedClient, id: string): Promise<ResolvedRef> {
  const { data } = await db.from("knowledge_bases").select("name").eq("id", id).maybeSingle();
  const name = (data as { name?: string } | null)?.name;
  return name ? { label: name } : { notFound: true };
}

interface WriteActionRow {
  id: string;
  tool_id: string;
  user_id: string;
  input: unknown;
  result: unknown;
  created_at: string;
}

/**
 * Mirrors undo_lead_action's own "which row am I undoing" lookup (by id, or
 * — when the model omitted actionId — the caller's most recent undoable
 * action) so the preview always describes the row the tool would actually
 * target. Builds a full sentence, never an id (BRIEF-PHASE-4D).
 *
 * The by-id branch filters on `user_id` too — undo-lead-action.ts refuses to
 * execute another user's action, but that check runs only at execute time,
 * after this preview has already rendered. Without the same filter here, the
 * preview would describe an action the tool will end up refusing — the
 * refusal is correct but the content already leaked (BRIEF-PHASE-4D-FIXUP
 * finding 2). A non-owned action id must resolve exactly like a nonexistent
 * one.
 */
async function resolveUndoAction(db: ScopedClient, auth: AuthContext, id: string | null, now: Date): Promise<ResolvedRef> {
  let target: WriteActionRow | null = null;
  if (id) {
    const { data } = await db
      .from("ai_write_actions")
      .select("id, tool_id, user_id, input, result, created_at")
      .eq("id", id)
      .eq("user_id", auth.userId)
      .maybeSingle();
    target = data as unknown as WriteActionRow | null;
  } else {
    const { data } = await db
      .from("ai_write_actions")
      .select("id, tool_id, user_id, input, result, created_at")
      .eq("user_id", auth.userId)
      .eq("status", "executed")
      .in("tool_id", UNDOABLE_TOOL_IDS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    target = data as unknown as WriteActionRow | null;
  }
  if (!target) return { notFound: true };

  const relativeTime = formatRelativeTime(target.created_at, now);
  const leadId = (target.input as { leadId?: string } | null)?.leadId;
  const leadLbl = leadId ? ((await fetchLeadLabel(db, auth, leadId)) ?? `NOT FOUND (${leadId})`) : "an unknown lead";

  if (target.tool_id === "update_lead_stage") {
    const newStage = (target.result as { stage?: string } | null)?.stage ?? "—";
    const oldListId = (target.result as { previous?: { list_id?: string } } | null)?.previous?.list_id;
    let oldStage = "—";
    if (oldListId) {
      const { data: list } = await db.from("lead_lists").select("name").eq("id", oldListId).maybeSingle();
      oldStage = (list as { name?: string } | null)?.name ?? `NOT FOUND (${oldListId})`;
    }
    return { label: buildUndoDescription({ kind: "stage", leadLabel: leadLbl, from: oldStage, to: newStage, relativeTime }) };
  }

  if (target.tool_id === "assign_lead") {
    const newAssigneeId = (target.input as { assigneeId?: string } | null)?.assigneeId;
    const oldAssigneeId = (target.result as { previous?: { assigned_to?: string | null } } | null)?.previous?.assigned_to;
    const newLbl = newAssigneeId ? ((await fetchAssigneeLabel(db, newAssigneeId)) ?? `NOT FOUND (${newAssigneeId})`) : "Unassigned";
    const oldLbl = oldAssigneeId ? ((await fetchAssigneeLabel(db, oldAssigneeId)) ?? `NOT FOUND (${oldAssigneeId})`) : "Unassigned";
    return { label: buildUndoDescription({ kind: "assignment", leadLabel: leadLbl, from: oldLbl, to: newLbl, relativeTime }) };
  }

  // Defensive fallback: an actionId can be hand-supplied and point at any tool's row, not just
  // an undoable one. The tool's own execute() independently refuses non-undoable tool_ids.
  return { label: buildUndoDescription({ kind: "generic", toolId: target.tool_id, relativeTime }) };
}

async function resolveRef(db: ScopedClient, auth: AuthContext, ref: EntityRef, now: Date): Promise<ResolvedRef> {
  const kind = ref.kind as EntityRefKind;
  switch (kind) {
    case "lead":
      return ref.id ? resolveLead(db, auth, ref.id) : { notFound: true };
    case "assignee":
      return ref.id ? resolveAssignee(db, ref.id) : { notFound: true };
    case "knowledge_base":
      return ref.id ? resolveKnowledgeBase(db, ref.id) : { notFound: true };
    case "undo_action":
      return resolveUndoAction(db, auth, ref.id, now);
  }
}

/**
 * POST /api/v1/ai/resolve-approval-refs
 * Resolves the entity ids on a pending write-tool approval card to display
 * labels — tenant-scoped, server-side. The AI SDK's toolApproval config
 * (installed ai@7.0.29) has no field on ToolApprovalRequestOutput to carry
 * extra payload data, so this client-called endpoint is the resolution path
 * (BRIEF-PHASE-4D "How to resolve", option 2).
 */
export async function POST(request: NextRequest) {
  if (!isAssistantEnabled()) return apiNotFound();

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: { refs?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!Array.isArray(body.refs) || body.refs.length === 0) {
    return apiValidationError({ refs: ["refs is required and must be a non-empty array"] });
  }
  if (body.refs.length > MAX_REFS) {
    return apiValidationError({ refs: [`refs must contain at most ${MAX_REFS} entries`] });
  }
  if (!body.refs.every(isValidRef)) {
    return apiValidationError({ refs: ["Each ref must be { kind, id } with a known kind and a UUID or null id"] });
  }
  const refs = body.refs as EntityRef[];

  const db = await scopedClient(auth);
  const now = new Date();

  const unique = new Map<string, EntityRef>();
  for (const ref of refs) unique.set(refKey(ref), ref);

  const entries = await Promise.all(
    [...unique.entries()].map(async ([key, ref]) => [key, await resolveRef(db, auth, ref, now)] as const),
  );

  const resolved: Record<string, ResolvedRef> = {};
  for (const [key, value] of entries) resolved[key] = value;

  return apiSuccess({ resolved });
}
