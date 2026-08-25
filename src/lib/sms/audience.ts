import type { AuthContext } from "@/lib/api/auth";
import type { FilterTree } from "@/lib/filters/types";
import { resolveAudienceCore, type ChannelAdapter, type ResolveAudienceClients } from "@/lib/outbound/audience";
import { toProviderRecipient, providerMsisdnToE164 } from "./phone";
import { loadSuppressedPhones } from "./suppression";

// Audience resolution for SMS blasts — the module where a mistake texts the
// wrong people. The channel-neutral mechanics (visibility scoping, dedupe,
// suppression batching) live in src/lib/outbound/audience.ts
// (OUTREACH-PHASE1-BRIEF.md §4); this file is now a thin SMS-specific
// wrapper around that shared core, kept for its pre-existing external
// contract (field names below) so every caller — and the regression tests in
// audience.test.ts / blast-composer.*.test.ts — keeps working unchanged.

export type { ResolveAudienceClients };

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

export type ResolveAudienceResult = { ok: true; audience: AudienceBreakdown } | { ok: false; errors: Record<string, string[]> };

interface SmsContact {
  msisdn: string;
  phoneE164: string;
}

interface SmsExcluded extends Record<string, number> {
  noPhone: number;
  foreignNumber: number;
  malformed: number;
  suppressed: number;
  duplicate: number;
}

const smsAdapter: ChannelAdapter<SmsContact, SmsExcluded> = {
  contactOf: (lead) => (lead.phone as string | null | undefined) ?? null,
  classify: (raw) => {
    const result = toProviderRecipient(raw);
    if (!result.ok) {
      const reason = result.reason === "missing" ? "noPhone" : result.reason === "foreign" ? "foreignNumber" : "malformed";
      return { ok: false, reason };
    }
    return { ok: true, contact: { msisdn: result.msisdn, phoneE164: providerMsisdnToE164(result.msisdn) } };
  },
  dedupeKey: (c) => c.phoneE164,
  loadSuppressed: loadSuppressedPhones,
  emptyExcluded: () => ({ noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicate: 0 }),
};

export async function resolveAudience(
  auth: AuthContext,
  tree: FilterTree,
  clients: ResolveAudienceClients
): Promise<ResolveAudienceResult> {
  const result = await resolveAudienceCore(auth, tree, clients, smsAdapter);
  if (!result.ok) return result;

  const toRow = (r: { leadId: string; contact: SmsContact; lead: Record<string, unknown> }): AudienceRow => ({
    leadId: r.leadId,
    phone: r.contact.msisdn,
    phoneE164: r.contact.phoneE164,
    lead: r.lead,
  });

  return {
    ok: true,
    audience: {
      matched: result.audience.matched,
      sendable: result.audience.sendable.map(toRow),
      suppressed: result.audience.suppressed.map(toRow),
      excluded: {
        noPhone: result.audience.excluded.noPhone,
        foreignNumber: result.audience.excluded.foreignNumber,
        malformed: result.audience.excluded.malformed,
        suppressed: result.audience.excluded.suppressed,
        duplicatePhone: result.audience.excluded.duplicate,
      },
    },
  };
}
