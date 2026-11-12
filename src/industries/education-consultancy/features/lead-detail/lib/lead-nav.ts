import { navState } from "../../record-preview/lib/nav";

/**
 * Prev/next context for the lead detail page (EDGEX-151). The leads table writes it to sessionStorage whenever it shows
 * a page of leads; the detail page reads it for J/K, the "12 of 444 in All leads" counter and the back link.
 * Every storage access is wrapped: a private window or blocked storage just means "no context" (arrows hidden).
 */
export const LEAD_NAV_KEY = "edgex.leadNav";

export interface LeadNavContext {
  /** Name of the view the user came from ("All leads", "My leads" …). */
  viewLabel: string;
  /** Where "← back" goes: the table URL with its search/filters. */
  href: string;
  /** API query that reproduces the view (search, f, sort, order, list, funnel …) without page/pageSize/count. */
  query: Record<string, string>;
  page: number;
  pageSize: number;
  /** Ids on the current page, in table order. */
  ids: string[];
  total: number;
}

export function isLeadNavContext(v: unknown): v is LeadNavContext {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.viewLabel === "string" &&
    typeof c.href === "string" &&
    !!c.query && typeof c.query === "object" &&
    Number.isInteger(c.page) && (c.page as number) >= 1 &&
    Number.isInteger(c.pageSize) && (c.pageSize as number) >= 1 &&
    Array.isArray(c.ids) && (c.ids as unknown[]).every((i) => typeof i === "string") &&
    Number.isInteger(c.total) && (c.total as number) >= 0
  );
}

export function writeLeadNav(ctx: LeadNavContext, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? sessionStorage).setItem(LEAD_NAV_KEY, JSON.stringify(ctx));
  } catch {
    /* storage unavailable: the detail page falls back to "no context" */
  }
}

export function readLeadNav(storage?: Pick<Storage, "getItem">): LeadNavContext | null {
  try {
    const raw = (storage ?? sessionStorage).getItem(LEAD_NAV_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLeadNavContext(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface ResolvedLeadNav {
  position: number;
  total: number;
  viewLabel: string;
  backHref: string;
  hasPrev: boolean;
  hasNext: boolean;
  /** Id on the current page, or null when the neighbour lives on the adjacent page (fetch it). */
  prevId: string | null;
  nextId: string | null;
}

/**
 * The context applies only when this lead is in it (a direct link or another tab leaves a stale list behind).
 * Returns null otherwise, which hides the arrows and the counter.
 */
export function resolveLeadNav(ctx: LeadNavContext | null, leadId: string): ResolvedLeadNav | null {
  if (!ctx) return null;
  const rowIndex = ctx.ids.indexOf(leadId);
  if (rowIndex < 0) return null;
  const st = navState({ rowIndex, rowCount: ctx.ids.length, page: ctx.page, pageSize: ctx.pageSize, total: ctx.total });
  return {
    position: st.position,
    total: st.total,
    viewLabel: ctx.viewLabel,
    backHref: ctx.href,
    hasPrev: st.hasPrev,
    hasNext: st.hasNext,
    prevId: st.prev?.kind === "row" ? ctx.ids[st.prev.index] : null,
    nextId: st.next?.kind === "row" ? ctx.ids[st.next.index] : null,
  };
}

/** The id J/K lands on across a page edge: fetches the neighbouring page with the view's own query. */
export async function fetchAdjacentLeadId(
  ctx: LeadNavContext,
  dir: "next" | "prev",
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; ctx: LeadNavContext } | null> {
  const page = dir === "next" ? ctx.page + 1 : ctx.page - 1;
  if (page < 1) return null;
  const params = new URLSearchParams(ctx.query);
  params.set("page", String(page));
  params.set("pageSize", String(ctx.pageSize));
  params.set("count", "0");
  try {
    const res = await fetcher(`/api/v1/leads?${params.toString()}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (body.data ?? []).map((l) => l.id);
    if (ids.length === 0) return null;
    return { id: dir === "next" ? ids[0] : ids[ids.length - 1], ctx: { ...ctx, page, ids } };
  } catch {
    return null;
  }
}

/**
 * After a hand-off the lead leaves the user's list: the NEXT lead of the view is where they carry on (strictly next: no
 * fallback to the previous row). Null = nothing to open on this page, go back to the view.
 */
export function nextLeadAfterHandOff(ctx: LeadNavContext | null, leadId: string): string | null {
  const r = resolveLeadNav(ctx, leadId);
  if (!r) return null;
  return r.nextId;
}
