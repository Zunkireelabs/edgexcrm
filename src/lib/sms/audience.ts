import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/api/auth";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { leadQueryScope } from "@/lib/api/permissions";
import { leadFields } from "@/lib/filters/registry/leads";
import { compileFilter, planFilter } from "@/lib/filters/compile";
import type { CompileCtx, FilterTree, ResolvedPermissions as FilterResolvedPermissions } from "@/lib/filters/types";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { toProviderRecipient, providerMsisdnToE164 } from "./phone";
import { loadSuppressedPhones } from "./suppression";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Audience resolution for SMS blasts — the module where a mistake texts the
// wrong people. Resolves through the caller's OWN visibility (visibleLeadsBase,
// the same uncapped RPC path GET /api/v1/leads uses), never a hand-rolled
// `.eq("tenant_id", ...)` query, so a rep can never blast leads they cannot
// see (docs/SMS-PHASE3A-BRIEF.md §3).

export interface AudienceRow {
  leadId: string;
  phone: string; // bare 10-digit MSISDN, provider shape
  phoneE164: string; // normalized, suppression key
  lead: Record<string, unknown>; // full row, for {{merge}} resolution
}

export interface AudienceBreakdown {
  matched: number; // leads the filter matched, before phone/suppression exclusions
  sendable: AudienceRow[];
  // Recipients otherwise textable but currently on the DNC list — /send
  // materializes these as auditable status='suppressed' sms_messages rows
  // rather than silently dropping them (SMS-PHASE3A-BRIEF.md §6 step 2).
  suppressed: AudienceRow[];
  excluded: {
    noPhone: number;
    foreignNumber: number;
    malformed: number;
    suppressed: number;
    duplicatePhone: number;
  };
}

export type ResolveAudienceResult =
  | { ok: true; audience: AudienceBreakdown }
  | { ok: false; errors: Record<string, string[]> };

interface LeadRow {
  id: string;
  phone: string | null;
  created_at: string;
  [key: string]: unknown;
}

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

export async function resolveAudience(
  auth: AuthContext,
  tree: FilterTree,
  clients: ResolveAudienceClients
): Promise<ResolveAudienceResult> {
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

  // Mirrors the leads route's own branch (src/app/(main)/api/v1/leads/route.ts):
  // visibleLeadsBase() is only chained with .select() on the RPC path (own/branch
  // scope) — its OWN unrestricted-scope branch already hardcodes .select("*").eq(...),
  // which cannot be re-.select()'d on top of. Unrestricted (owner/admin) callers
  // build the plain scoped query directly instead of going through visibleLeadsBase.
  const useVisibilityRpc = !!(scope.restrictToSelf || scope.branchId);
  let query = useVisibilityRpc
    ? visibleLeadsBase({ user: userClient, service }, auth.tenantId, scope).select(selectColumns)
    : service.from("leads").select(selectColumns).eq("tenant_id", auth.tenantId);
  query = query.is("deleted_at", null);
  query = compileFilter(query, tree, registry, compileCtx);

  const { data, error } = await query;
  if (error) throw new Error(`resolveAudience: lead query failed: ${error.message}`);

  const leads = ((data ?? []) as unknown as LeadRow[]).slice();
  // Deterministic order for the duplicate-phone collapse below — neither the
  // plain table query nor the leads_visible_to_user() RPC guarantees row order.
  leads.sort((a, b) => {
    const byCreated = a.created_at.localeCompare(b.created_at);
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
  });

  const matched = leads.length;
  const excluded = { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 };

  // Pass 1: phone classification. Every rejection lands in its bucket, none silently dropped.
  const candidates: { lead: LeadRow; msisdn: string; phoneE164: string }[] = [];
  for (const lead of leads) {
    const result = toProviderRecipient(lead.phone);
    if (!result.ok) {
      if (result.reason === "missing") excluded.noPhone++;
      else if (result.reason === "foreign") excluded.foreignNumber++;
      else excluded.malformed++;
      continue;
    }
    candidates.push({ lead, msisdn: result.msisdn, phoneE164: providerMsisdnToE164(result.msisdn) });
  }

  // Pass 2: duplicate-phone collapse — keep the first by (created_at, id), which
  // `leads` is already sorted by; count the rest, never text them twice.
  const seenPhones = new Set<string>();
  const deduped: { lead: LeadRow; msisdn: string; phoneE164: string }[] = [];
  for (const c of candidates) {
    if (seenPhones.has(c.phoneE164)) {
      excluded.duplicatePhone++;
      continue;
    }
    seenPhones.add(c.phoneE164);
    deduped.push(c);
  }

  // Pass 3: one batched suppression lookup, never per-recipient.
  const suppressedSet = await loadSuppressedPhones(
    clients.db,
    auth.tenantId,
    deduped.map((c) => c.phoneE164)
  );

  const sendable: AudienceRow[] = [];
  const suppressed: AudienceRow[] = [];
  for (const c of deduped) {
    const row: AudienceRow = { leadId: c.lead.id, phone: c.msisdn, phoneE164: c.phoneE164, lead: c.lead };
    if (suppressedSet.has(c.phoneE164)) {
      excluded.suppressed++;
      suppressed.push(row);
      continue;
    }
    sendable.push(row);
  }

  return { ok: true, audience: { matched, sendable, suppressed, excluded } };
}
