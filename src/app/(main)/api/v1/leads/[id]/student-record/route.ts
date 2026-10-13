import { NextRequest } from "next/server";
import { authenticateRequest, getClientIp, requireLeadAccess, requireLeadBranchAccess } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";
import {
  LIST_COLUMNS,
  LIST_TABLES,
  coerceListsPayload,
  type ListName,
  type ListRow,
} from "@/lib/leads/student-record-lists";

// GET / PUT /api/v1/leads/[id]/student-record — the three "add as many as you need" lists of the Student Details pop-up:
// work experience, references and test scores (tables from migrations 237, 238, 235). The flat fields (qualification details,
// financial, personal…) save through PATCH /api/v1/leads/[id]; these lists are rows, so they have their own route.
//
// PUT is "replace this list with exactly these rows", per list that is present in the body (an absent list is left alone):
// rows whose id is already stored for THIS lead are updated, rows without one are inserted (always with a server-made id — a
// client id is never used as a database key), and stored rows missing from the list are deleted. The response is the stored
// lists, so the pop-up shows what was really saved.
//
// Access mirrors the lead itself: reading needs the same visibility as the lead page, writing needs the same right as PATCH
// (requireLeadAccess). Tenant-scoped; education-only (the student-record feature).

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = Awaited<ReturnType<typeof scopedClient>>;
type StoredLists = Record<ListName, Array<Record<string, unknown>>>;

/** How each list is read back — most useful order first; ties keep the order they were entered in. */
const ORDER: Record<ListName, Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>> = {
  work_experience: [{ column: "start_date", ascending: false, nullsFirst: false }, { column: "created_at", ascending: true }],
  references: [{ column: "created_at", ascending: true }],
  test_scores: [{ column: "date_of_exam", ascending: false, nullsFirst: false }, { column: "created_at", ascending: true }],
};

async function readLists(db: Db, leadId: string, names: readonly ListName[] = ["work_experience", "references", "test_scores"]): Promise<{ lists: StoredLists; error: boolean }> {
  const out: StoredLists = { work_experience: [], references: [], test_scores: [] };
  let failed = false;
  await Promise.all(
    names.map(async (name) => {
      let q = db.from(LIST_TABLES[name]).select(["id", ...LIST_COLUMNS[name]].join(", ")).eq("lead_id", leadId);
      for (const o of ORDER[name]) q = q.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
      const { data, error } = await q;
      if (error) failed = true;
      else out[name] = (data ?? []) as unknown as Array<Record<string, unknown>>;
    }),
  );
  return { lists: out, error: failed };
}

/** Make the stored rows of one list equal `rows`. Inserts/updates first, deletes last, so a failure part-way never loses data. */
async function syncList(db: Db, leadId: string, name: ListName, rows: ListRow[]): Promise<boolean> {
  const table = LIST_TABLES[name];
  const columns = LIST_COLUMNS[name];

  const { data: existing, error: readError } = await db.from(table).select("id").eq("lead_id", leadId);
  if (readError) return false;
  const storedIds = new Set(((existing ?? []) as unknown as Array<{ id: string }>).map((r) => r.id));
  const keptIds = new Set<string>();

  const valuesOf = (row: ListRow) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null]));

  for (const row of rows) {
    if (row.id && storedIds.has(row.id)) {
      keptIds.add(row.id);
      const { error } = await db.from(table).update(valuesOf(row)).eq("id", row.id).eq("lead_id", leadId);
      if (error) return false;
    }
  }
  // New rows one at a time, in the order they were entered, so they read back in that order.
  for (const row of rows) {
    if (row.id && storedIds.has(row.id)) continue;
    const { error } = await db.from(table).insert({ lead_id: leadId, ...valuesOf(row) });
    if (error) return false;
  }
  const toDelete = [...storedIds].filter((id) => !keptIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await db.from(table).delete().in("id", toDelete).eq("lead_id", leadId);
    if (error) return false;
  }
  return true;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: `/api/v1/leads/${id}/student-record` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.STUDENT_RECORD)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid lead id"] });

  const db = await scopedClient(auth);
  const { data: lead } = await db.from("leads").select("id, assigned_to, branch_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

  // Same visibility as the lead page: an own-scope counselor sees only their leads (or ones they collaborate on), a branch manager their branch.
  const membership = await getLeadMembership(db.raw(), auth.tenantId, id);
  const restrictedAndUnassigned =
    shouldRestrictToSelf(auth.permissions) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || leadRow.assigned_to === auth.userId);
  if (restrictedAndUnassigned) {
    if (!(await isLeadCollaborator(db.raw(), auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  } else if (!requireLeadBranchAccess(auth, leadRow, membership)) {
    if (!(await isLeadCollaborator(db.raw(), auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  }

  const { lists, error } = await readLists(db, id);
  if (error) {
    log.error({ leadId: id }, "Failed to read student record lists");
    return apiServiceUnavailable("Failed to load the student record");
  }
  return apiSuccess(lists);
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PUT", path: `/api/v1/leads/${id}/student-record` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.STUDENT_RECORD)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid lead id"] });

  const db = await scopedClient(auth);
  const { data: lead } = await db.from("leads").select("id, assigned_to, branch_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

  // Writing needs the same right as editing the lead (PATCH): an own-scope counselor only their own lead, a viewer never.
  const membership = await getLeadMembership(db.raw(), auth.tenantId, id);
  if (!requireLeadAccess(auth, leadRow, membership)) {
    const restrictedAndUnassigned =
      shouldRestrictToSelf(auth.permissions) &&
      !(membership.some((m) => m.assigned_to === auth.userId) || leadRow.assigned_to === auth.userId);
    return restrictedAndUnassigned ? apiNotFound("Lead") : apiForbidden(PERMISSION_DENIED_MESSAGE);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return apiValidationError({ body: ["Request body must be a JSON object"] });
  }

  const { lists, errors } = coerceListsPayload(body);
  if (Object.keys(errors).length > 0) return apiValidationError(errors);

  const names = Object.keys(lists) as ListName[];
  const before = names.length > 0 ? await readLists(db, id, names) : null;
  if (before?.error) return apiServiceUnavailable("Failed to save the student record");

  for (const name of names) {
    const ok = await syncList(db, id, name, lists[name] ?? []);
    if (!ok) {
      log.error({ leadId: id, list: name }, "Failed to save student record list");
      return apiServiceUnavailable("Failed to save the student record");
    }
  }

  if (names.length > 0) {
    await db.from("leads").update({ updated_at: new Date().toISOString() }).eq("id", id);
    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.updated",
      entityType: "lead",
      entityId: id,
      changes: Object.fromEntries(
        names.map((n) => [n, { old: before?.lists[n].length ?? 0, new: lists[n]?.length ?? 0 }]),
      ),
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId,
    });
  }

  const { lists: stored, error } = await readLists(db, id);
  if (error) return apiServiceUnavailable("Saved, but could not read the student record back");
  return apiSuccess(stored);
}
