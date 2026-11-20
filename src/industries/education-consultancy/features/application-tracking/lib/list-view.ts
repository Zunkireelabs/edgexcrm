// Applications List view (EDGEX-141 Phase 4): the pure parts. Column catalogue, per-user prefs
// (layout under its own key of the Leads grid-prefs mechanism; page size), page maths, selection
// and the bulk PATCH runner. The component (components/applications-list.tsx) only draws.

import { normalizeLayout, type ColumnLayout } from "@/components/dashboard/leads/table/grid-layout";
import { clearGridPrefs, loadGridPrefs, saveGridPrefs, type GridPrefs } from "@/components/dashboard/leads/table/grid-prefs";
import { DEFAULT_LIST_PAGE_SIZE, LIST_PAGE_SIZES } from "./board-index";
import type { ApplicationSortField } from "./applications-query";

export type ListColumnKey =
  | "university"
  | "program"
  | "stage"
  | "time_in_stage"
  | "counsellor"
  | "intake"
  | "deadline"
  | "docs"
  | "country"
  | "updated"
  | "offer_type"
  | "fee_paid"
  | "open_tasks"
  | "created";

export interface ListColumnDef {
  key: ListColumnKey;
  label: string;
  /**
   * Mockup colgroup widths, except three headers that would truncate at the mockup's minimum
   * (Time in stage 120 -> 160 with its sort arrow, Deadline 110 -> 130, Docs 80 -> 90; Updated and Created 130). The table stretches past these.
   */
  width: number;
  /** The column menu offers Sort ascending / descending. */
  sortField?: ApplicationSortField;
  /** "Filter by <field>" opens the filter menu on this registry key. */
  filterFieldKey?: string;
}

/** Shown by default, in this order (Student is always first and sticky; it's not in the layout). */
export const LIST_DEFAULT_KEYS: ListColumnKey[] = ["university", "program", "stage", "time_in_stage", "counsellor", "intake", "deadline", "docs"];
/** Available in View settings, hidden by default. */
export const LIST_HIDDEN_KEYS: ListColumnKey[] = ["country", "updated", "offer_type", "fee_paid", "open_tasks", "created"];

export const LIST_COLUMNS: Record<ListColumnKey, ListColumnDef> = {
  university: { key: "university", label: "University", width: 210, sortField: "university", filterFieldKey: "university" },
  program: { key: "program", label: "Program", width: 180, filterFieldKey: "program" },
  stage: { key: "stage", label: "Stage", width: 190, filterFieldKey: "stage" },
  time_in_stage: { key: "time_in_stage", label: "Time in stage", width: 160, sortField: "stage", filterFieldKey: "time_in_stage" },
  counsellor: { key: "counsellor", label: "Counsellor", width: 160, filterFieldKey: "counsellor" },
  intake: { key: "intake", label: "Intake", width: 110, filterFieldKey: "intake" },
  deadline: { key: "deadline", label: "Deadline", width: 130, sortField: "deadline", filterFieldKey: "deadline" },
  docs: { key: "docs", label: "Docs", width: 90 },
  country: { key: "country", label: "Country", width: 140, filterFieldKey: "country" },
  updated: { key: "updated", label: "Updated", width: 130, sortField: "updated", filterFieldKey: "updated_at" },
  offer_type: { key: "offer_type", label: "Offer type", width: 140, filterFieldKey: "offer_type" },
  fee_paid: { key: "fee_paid", label: "Fee paid", width: 100, filterFieldKey: "fee_paid" },
  open_tasks: { key: "open_tasks", label: "Open tasks", width: 100 },
  created: { key: "created", label: "Created", width: 130, sortField: "created", filterFieldKey: "created_at" },
};
export const LIST_ALL_KEYS: ListColumnKey[] = [...LIST_DEFAULT_KEYS, ...LIST_HIDDEN_KEYS];
export const STUDENT_WIDTH = 190;

// ── per-user prefs ──────────────────────────────────────────────────────────────────────────────

/** Own key of the Leads grid-prefs mechanism: `leads-grid-v2:<tenant>:<user>:applications-list`. */
export const LIST_PREFS_SCOPE = "applications-list";

export function loadListLayout(tenantId: string, userId: string): ColumnLayout {
  const prefs = loadGridPrefs({ tenantId, userId, scope: LIST_PREFS_SCOPE, validKeys: LIST_ALL_KEYS, defaultKeys: LIST_DEFAULT_KEYS });
  // The Applications list has no pins (the Student column is the only sticky one).
  return normalizeLayout(prefs.keys, []);
}

export function saveListLayout(tenantId: string, userId: string, layout: ColumnLayout): void {
  const prefs: GridPrefs = { keys: layout.keys, pins: [], labels: {}, widths: {} };
  saveGridPrefs(tenantId, userId, prefs, LIST_PREFS_SCOPE);
}

export function resetListLayout(tenantId: string, userId: string): ColumnLayout {
  clearGridPrefs(tenantId, userId, LIST_PREFS_SCOPE);
  return { keys: [...LIST_DEFAULT_KEYS], pins: [] };
}

export function pageSizeKey(tenantId: string, userId: string): string {
  return `applications-list-page-size:${tenantId}:${userId}`;
}

export function parsePageSize(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return (LIST_PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_LIST_PAGE_SIZE;
}

export function loadPageSize(tenantId: string, userId: string): number {
  try {
    return parsePageSize(localStorage.getItem(pageSizeKey(tenantId, userId)));
  } catch {
    return DEFAULT_LIST_PAGE_SIZE;
  }
}

export function savePageSize(tenantId: string, userId: string, size: number): void {
  try {
    localStorage.setItem(pageSizeKey(tenantId, userId), String(parsePageSize(size)));
  } catch {
    // private mode: the size still applies for this session
  }
}

// ── paging ──────────────────────────────────────────────────────────────────────────────────────

/** ?page= -> a 1-based page; anything unreadable is page 1. */
export function parsePage(raw: string | null | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return n >= 1 ? n : 1;
}

export interface PageWindow {
  page: number;
  totalPages: number;
  offset: number;
  /** 0-based index of the first row shown, and the exclusive end (GridPagination's start/end). */
  start: number;
  end: number;
}

/** Clamp a requested page into [1, totalPages] for this total; total 0 is "page 1 of 1". */
export function pageWindow(requested: number, size: number, total: number): PageWindow {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), totalPages);
  const offset = (page - 1) * size;
  return { page, totalPages, offset, start: offset, end: Math.min(offset + size, total) };
}

// ── selection (current page only) ──────────────────────────────────────────────────────────────

export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Header checkbox: selects the current page, or clears it when the page is already all selected. */
export function togglePage(selected: ReadonlySet<string>, pageIds: string[]): Set<string> {
  const all = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  return all ? new Set() : new Set(pageIds);
}

export function headerCheckState(selected: ReadonlySet<string>, pageIds: string[]): boolean | "indeterminate" {
  const n = pageIds.filter((id) => selected.has(id)).length;
  if (n === 0) return false;
  return n === pageIds.length ? true : "indeterminate";
}

// ── bulk PATCH (no new endpoint) ───────────────────────────────────────────────────────────────

export const BULK_CONCURRENCY = 5;

export interface BulkResult {
  ok: string[];
  failed: string[];
}

/**
 * PATCH /api/v1/applications/<id> with the same body for every id, at most `concurrency` in flight.
 * Never throws: a rejected or non-2xx request is a failed id.
 */
export async function runBulkPatch(
  ids: string[],
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  concurrency: number = BULK_CONCURRENCY,
): Promise<BulkResult> {
  const ok: string[] = [];
  const failed: string[] = [];
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const res = await fetchImpl(`/api/v1/applications/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        (res.ok ? ok : failed).push(id);
      } catch {
        failed.push(id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), ids.length) }, worker));
  // Report in the caller's order.
  const order = new Map(ids.map((id, i) => [id, i]));
  const byOrder = (a: string, b: string) => order.get(a)! - order.get(b)!;
  return { ok: ok.sort(byOrder), failed: failed.sort(byOrder) };
}

/** Toast text: "3 applications moved" / "3 of 5 updated" (the failed rows stay selected). */
export function bulkToast(result: BulkResult, verb: string): { tone: "success" | "error"; text: string } {
  const total = result.ok.length + result.failed.length;
  if (result.failed.length === 0) return { tone: "success", text: `${total} ${total === 1 ? "application" : "applications"} ${verb}` };
  return { tone: "error", text: `${result.ok.length} of ${total} updated` };
}
