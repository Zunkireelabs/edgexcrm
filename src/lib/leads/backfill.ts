/**
 * Lead dedup backfill — collapses existing duplicate email groups using B1's mergeLeads/undoMerge.
 *
 * Hard rules:
 *   • DRY-RUN IS THE DEFAULT. runBackfill({ apply: false }) writes nothing.
 *   • apply=true is idempotent: leads already merged_into IS NOT NULL are skipped.
 *   • Per-group errors are collected and the run continues; no group error aborts the whole run.
 *   • undoBackfill reverses all backfill merges for the tenant via undoMerge.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { mergeLeads, undoMerge } from "./merge";
import type { Lead } from "@/types/database";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// ── types ──────────────────────────────────────────────────────────────────

export interface BackfillGroup {
  tenantId: string;
  normalizedEmail: string;
  canonicalId: string;
  absorbedIds: string[];
  /** Snapshot of fields that would change on the canonical (fill-empty deltas from each absorbed) */
  fieldDelta: Record<string, unknown>;
  /** Child-row counts per absorbed lead, keyed by leadId */
  childCounts: Record<string, ChildCounts>;
}

export interface ChildCounts {
  lead_notes: number;
  lead_activities: number;
  lead_checklists: number;
  lead_submissions: number;
  tasks: number;
  email_threads: number;
}

export interface BackfillReport {
  totalGroups: number;
  totalAbsorbed: number;
  /** Up to 20 groups shown in detail */
  sample: BackfillGroup[];
}

export interface BackfillApplyResult {
  merged: number;
  skipped: number;
  errors: Array<{ canonicalId: string; absorbedId: string; error: string }>;
}

export interface UndoBackfillResult {
  undone: number;
  errors: Array<{ mergeId: string; error: string }>;
}

// ── helpers ────────────────────────────────────────────────────────────────

async function countChildRows(
  supabase: SupabaseServiceClient,
  leadId: string
): Promise<ChildCounts> {
  const [notes, activities, checklists, submissions, tasks, threads] = await Promise.all([
    supabase.from("lead_notes").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    supabase.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    supabase.from("lead_checklists").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    supabase.from("lead_submissions").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    supabase.from("email_threads").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
  ]);
  return {
    lead_notes: notes.count ?? 0,
    lead_activities: activities.count ?? 0,
    lead_checklists: checklists.count ?? 0,
    lead_submissions: submissions.count ?? 0,
    tasks: tasks.count ?? 0,
    email_threads: threads.count ?? 0,
  };
}

// Returns only the scalar fields that would be filled-empty on canonical from absorbed.
function computeFieldDelta(canonical: Lead, absorbeds: Lead[]): Record<string, unknown> {
  const FILL_FIELDS = ["first_name", "last_name", "email", "phone", "city", "country"] as const;
  const delta: Record<string, unknown> = {};
  for (const field of FILL_FIELDS) {
    if (!canonical[field]) {
      for (const a of absorbeds) {
        if (a[field]) { delta[field] = a[field]; break; }
      }
    }
  }
  return delta;
}

// ── planBackfill ───────────────────────────────────────────────────────────

/**
 * Find all live duplicate email groups. No writes.
 * Returns groups sorted by tenant + email; each group has the canonical and absorbed candidates.
 */
export async function planBackfill(
  supabase: SupabaseServiceClient,
  opts: { tenantId?: string } = {}
): Promise<BackfillGroup[]> {
  // Fetch all live, final, unmerged leads with a normalized_email
  let query = supabase
    .from("leads")
    .select("id, tenant_id, normalized_email, first_name, last_name, email, phone, city, country, created_at, merged_into")
    .not("normalized_email", "is", null)
    .neq("email", "")
    .is("deleted_at", null)
    .eq("is_final", true)
    .is("merged_into", null);

  if (opts.tenantId) {
    query = query.eq("tenant_id", opts.tenantId);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new Error(`planBackfill: query failed — ${error.message}`);

  type LeadRow = {
    id: string;
    tenant_id: string;
    normalized_email: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    country: string | null;
    created_at: string;
    merged_into: string | null;
  };

  const rows = (data ?? []) as LeadRow[];

  // Group by (tenant_id, normalized_email)
  const map = new Map<string, LeadRow[]>();
  for (const row of rows) {
    const key = `${row.tenant_id}::${row.normalized_email}`;
    const existing = map.get(key) ?? [];
    existing.push(row);
    map.set(key, existing);
  }

  // Keep only groups with count > 1
  const groups: BackfillGroup[] = [];

  for (const members of map.values()) {
    if (members.length <= 1) continue;

    // Canonical = oldest created_at; tie → lowest id (lexicographic)
    const sorted = [...members].sort((a, b) => {
      const tDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (tDiff !== 0) return tDiff;
      return a.id < b.id ? -1 : 1;
    });

    const canonical = sorted[0];
    const absorbeds = sorted.slice(1);

    // Compute child counts for each absorbed lead in parallel
    const childCountsArr = await Promise.all(absorbeds.map((a) => countChildRows(supabase, a.id)));
    const childCounts: Record<string, ChildCounts> = {};
    absorbeds.forEach((a, i) => { childCounts[a.id] = childCountsArr[i]; });

    groups.push({
      tenantId: canonical.tenant_id,
      normalizedEmail: canonical.normalized_email,
      canonicalId: canonical.id,
      absorbedIds: absorbeds.map((a) => a.id),
      fieldDelta: computeFieldDelta(canonical as unknown as Lead, absorbeds as unknown as Lead[]),
      childCounts,
    });
  }

  return groups;
}

// ── runBackfill ────────────────────────────────────────────────────────────

/**
 * Dry-run (apply=false, the default): returns a report with no writes.
 * Apply (apply=true): merges each absorbed lead into its canonical; idempotent.
 */
export async function runBackfill(
  supabase: SupabaseServiceClient,
  opts: { apply?: boolean; tenantId?: string } = {}
): Promise<BackfillReport | BackfillApplyResult> {
  const { apply = false, tenantId } = opts;

  const groups = await planBackfill(supabase, { tenantId });

  if (!apply) {
    // Dry-run: return report, write nothing
    const report: BackfillReport = {
      totalGroups: groups.length,
      totalAbsorbed: groups.reduce((n, g) => n + g.absorbedIds.length, 0),
      sample: groups.slice(0, 20),
    };
    return report;
  }

  // Apply: merge each absorbed lead into its canonical
  let merged = 0;
  let skipped = 0;
  const errors: BackfillApplyResult["errors"] = [];

  for (const group of groups) {
    for (const absorbedId of group.absorbedIds) {
      // Idempotency: re-fetch the lead to check if already merged
      const { data: current } = await supabase
        .from("leads")
        .select("id, merged_into, deleted_at")
        .eq("id", absorbedId)
        .maybeSingle();

      const row = current as { id: string; merged_into: string | null; deleted_at: string | null } | null;
      if (!row || row.merged_into !== null || row.deleted_at !== null) {
        skipped++;
        continue;
      }

      try {
        await mergeLeads(supabase, {
          tenantId: group.tenantId,
          canonicalId: group.canonicalId,
          absorbedId,
          mergedBy: null,
          source: "backfill",
        });
        merged++;
      } catch (err) {
        // Record and continue — one group failure must not abort the run
        errors.push({
          canonicalId: group.canonicalId,
          absorbedId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { merged, skipped, errors };
}

// ── undoBackfill ───────────────────────────────────────────────────────────

/**
 * Undo all backfill merges for a tenant (or all tenants if tenantId is omitted).
 * Processes newest-first so chains unwind correctly.
 */
export async function undoBackfill(
  supabase: SupabaseServiceClient,
  opts: { tenantId?: string } = {}
): Promise<UndoBackfillResult> {
  let query = supabase
    .from("lead_merges")
    .select("id, tenant_id")
    .eq("source", "backfill")
    .is("undone_at", null)
    .order("created_at", { ascending: false });

  if (opts.tenantId) {
    query = query.eq("tenant_id", opts.tenantId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`undoBackfill: query failed — ${error.message}`);

  const rows = (data ?? []) as { id: string; tenant_id: string }[];
  let undone = 0;
  const errors: UndoBackfillResult["errors"] = [];

  for (const row of rows) {
    try {
      await undoMerge(supabase, row.id, row.tenant_id, null);
      undone++;
    } catch (err) {
      errors.push({
        mergeId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { undone, errors };
}
