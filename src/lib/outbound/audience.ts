import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/api/auth";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { leadQueryScope } from "@/lib/api/permissions";
import { leadFields } from "@/lib/filters/registry/leads";
import { compileFilter, planFilter } from "@/lib/filters/compile";
import type { CompileCtx, FilterTree, ResolvedPermissions as FilterResolvedPermissions } from "@/lib/filters/types";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Channel-neutral core of blast audience resolution — extracted from
// src/lib/sms/audience.ts (OUTREACH-PHASE1-BRIEF.md §4). That module's own
// header calls it "the module where a mistake texts the wrong people"; the
// same is true here for whichever channel calls it. Resolves through the
// caller's OWN visibility (visibleLeadsBase, the same uncapped RPC path
// GET /api/v1/leads uses), never a hand-rolled `.eq("tenant_id", ...)` query,
// so a rep can never blast leads they cannot see.
//
// Only the CONTACTABILITY step is channel-specific — which lead column, how
// it normalizes, what counts as invalid, and the suppression lookup. That
// part is injected via ChannelAdapter. src/lib/sms/audience.ts and
// src/lib/email/outbound/audience.ts are thin wrappers around this file that
// preserve their own pre-existing external contracts (field names, exclusion
// keys) — do NOT fork this logic into a second copy; extend the adapter
// instead.

export interface LeadRow {
  id: string;
  created_at: string;
  [key: string]: unknown;
}

export interface AudienceRow<TContact> {
  leadId: string;
  contact: TContact;
  lead: LeadRow;
}

export interface ClassifyResult<TContact> {
  ok: boolean;
  contact?: TContact;
  reason?: string;
}

/**
 * Channel-specific plug-in. `classify` combines normalization + validation in
 * one step (mirrors src/lib/sms/phone.ts's toProviderRecipient shape) so a
 * channel can report distinct reasons (missing vs. foreign vs. malformed)
 * without a separate normalize() call the caller would have to sequence
 * correctly.
 */
export interface ChannelAdapter<TContact, TExcluded extends Record<string, number>> {
  /** Raw stored contact value off the lead row (lead.phone | lead.email). */
  contactOf(lead: LeadRow): string | null | undefined;
  /** Classify + normalize the raw value. "ok" carries the normalized contact
   *  value; otherwise `reason` must be a key of TExcluded (other than
   *  "suppressed"/"duplicate", which this module owns). */
  classify(raw: string | null | undefined): { ok: true; contact: TContact } | { ok: false; reason: keyof TExcluded };
  /** The string identity used for both the dedupe pass and the suppression
   *  lookup (phoneE164 for SMS; the normalized address itself for email). */
  dedupeKey(contact: TContact): string;
  /** One batched suppression lookup — never one query per recipient. */
  loadSuppressed(db: ScopedClient, tenantId: string, keys: string[]): Promise<Set<string>>;
  /** Zero-initialized exclusion counters: one key per classify() reason, plus
   *  "suppressed" and "duplicate". */
  emptyExcluded(): TExcluded;
}

export interface AudienceBreakdown<TContact, TExcluded> {
  matched: number;
  sendable: AudienceRow<TContact>[];
  suppressed: AudienceRow<TContact>[];
  excluded: TExcluded;
}

export type ResolveAudienceResult<TContact, TExcluded> =
  | { ok: true; audience: AudienceBreakdown<TContact, TExcluded> }
  | { ok: false; errors: Record<string, string[]> };

export interface ResolveAudienceClients {
  /** RLS-context client (must carry a real `auth.uid()`) — required by
   * visibleLeadsBase's own/branch-scope RPC branches. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: SupabaseClient<any>;
  /** Service/scoped client for the unrestricted (owner/admin) branch. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: SupabaseClient<any>;
  /** Tenant-scoped wrapper for the suppression batch lookup. */
  db: ScopedClient;
}

export async function resolveAudienceCore<TContact, TExcluded extends Record<string, number> & { suppressed: number; duplicate: number }>(
  auth: AuthContext,
  tree: FilterTree,
  clients: ResolveAudienceClients,
  adapter: ChannelAdapter<TContact, TExcluded>
): Promise<ResolveAudienceResult<TContact, TExcluded>> {
  // Same structural cast the leads route uses (src/app/(main)/api/v1/leads/route.ts:200-209).
  const compileCtx: CompileCtx = {
    tz: "UTC",
    now: new Date(),
    industryId: auth.industryId,
    permissions: auth.permissions as unknown as FilterResolvedPermissions,
  };
  const registry = leadFields(compileCtx);

  const filterPlan = planFilter(tree, registry, compileCtx);
  if (!filterPlan.ok) return { ok: false, errors: filterPlan.errors };

  const { user: userClient, service } = clients;

  const poolSlug =
    auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
      ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
      : null;
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId, poolSlug);

  const selectColumns = filterPlan.embeds.length > 0 ? `*,${filterPlan.embeds.join(",")}` : "*";

  // Mirrors the leads route's own branch: visibleLeadsBase() is only chained
  // with .select() on the RPC path (own/branch scope) — its own unrestricted-
  // scope branch already hardcodes .select("*").eq(...), which cannot be
  // re-.select()'d on top of. Unrestricted (owner/admin) callers build the
  // plain scoped query directly instead of going through visibleLeadsBase.
  const useVisibilityRpc = !!(scope.restrictToSelf || scope.branchId);
  function buildQuery() {
    let q = useVisibilityRpc
      ? visibleLeadsBase({ user: userClient, service }, auth.tenantId, scope).select(selectColumns)
      : service.from("leads").select(selectColumns).eq("tenant_id", auth.tenantId);
    q = q.is("deleted_at", null);
    q = compileFilter(q, tree, registry, compileCtx);
    return q;
  }

  // PostgREST's default max-rows silently caps a single request at 1000 rows
  // — confirmed against a real 16,761-lead local tenant (OUTREACH-PHASE1-
  // BRIEF.md §4's scale check): an unfiltered query for "everyone" returned
  // exactly 1000 rows with NO error, no truncation signal, nothing. A single
  // unpaged `await query` here would silently drop 94% of a real Admizz
  // audience while the composer reported "1000 sendable of 1000 matched" as
  // if that were the whole tenant — the exact "sends 2000, stops, reports
  // success" failure shape §6 calls out for the daily cap, just one layer
  // earlier. This is pre-existing behavior inherited unchanged from
  // src/lib/sms/audience.ts (SMS's own unrestricted-scope blasts hit the
  // identical cap) — fixing it here fixes both channels.
  //
  // The first request is issued exactly as before (no .range() call) so the
  // hard constraint holds: SMS's audience.test.ts fakes a bare
  // `.is() -> Promise` chain with no .range(), and a normal (<1000-row)
  // result never exercises the code below, so that mock — and the SMS
  // behavior it pins — is untouched. .range() is only reached, and only
  // needs to exist, once a page actually comes back at the page-size
  // boundary, which no existing test fixture does.
  const LEAD_PAGE_SIZE = 1000;
  const firstQuery = await buildQuery();
  if (firstQuery.error) throw new Error(`resolveAudienceCore: lead query failed: ${firstQuery.error.message}`);
  const leads: LeadRow[] = (firstQuery.data ?? []) as unknown as LeadRow[];
  for (let offset = LEAD_PAGE_SIZE; leads.length === offset; offset += LEAD_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + LEAD_PAGE_SIZE - 1);
    if (error) throw new Error(`resolveAudienceCore: lead query failed: ${error.message}`);
    const page = (data ?? []) as unknown as LeadRow[];
    leads.push(...page);
    if (page.length < LEAD_PAGE_SIZE) break;
  }
  // Deterministic order for the duplicate collapse below — neither the plain
  // table query nor the leads_visible_to_user() RPC guarantees row order.
  leads.sort((a, b) => {
    const byCreated = a.created_at.localeCompare(b.created_at);
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
  });

  const matched = leads.length;
  const excluded = adapter.emptyExcluded();

  // Pass 1: contactability classification. Every rejection lands in its
  // bucket, none silently dropped.
  const candidates: { lead: LeadRow; contact: TContact }[] = [];
  for (const lead of leads) {
    const raw = adapter.contactOf(lead);
    const result = adapter.classify(raw);
    if (!result.ok) {
      const key = result.reason;
      (excluded as Record<string, number>)[key as string] = ((excluded[key] as number) ?? 0) + 1;
      continue;
    }
    candidates.push({ lead, contact: result.contact });
  }

  // Pass 2: duplicate-contact collapse — keep the first by (created_at, id),
  // which `leads` is already sorted by; count the rest, never send twice.
  const seenKeys = new Set<string>();
  const deduped: { lead: LeadRow; contact: TContact }[] = [];
  for (const c of candidates) {
    const key = adapter.dedupeKey(c.contact);
    if (seenKeys.has(key)) {
      excluded.duplicate++;
      continue;
    }
    seenKeys.add(key);
    deduped.push(c);
  }

  // Pass 3: one batched suppression lookup, never per-recipient.
  const suppressedSet = await adapter.loadSuppressed(
    clients.db,
    auth.tenantId,
    deduped.map((c) => adapter.dedupeKey(c.contact))
  );

  const sendable: AudienceRow<TContact>[] = [];
  const suppressed: AudienceRow<TContact>[] = [];
  for (const c of deduped) {
    const row: AudienceRow<TContact> = { leadId: c.lead.id, contact: c.contact, lead: c.lead };
    if (suppressedSet.has(adapter.dedupeKey(c.contact))) {
      excluded.suppressed++;
      suppressed.push(row);
      continue;
    }
    sendable.push(row);
  }

  return { ok: true, audience: { matched, sendable, suppressed, excluded } };
}
