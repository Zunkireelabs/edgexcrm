import type { AuthContext } from "@/lib/api/auth";
import type { FilterTree } from "@/lib/filters/types";
import { resolveAudienceCore, type ChannelAdapter, type ResolveAudienceClients } from "@/lib/outbound/audience";
import { normalizeEmail, loadSuppressedEmails } from "./suppression";

// Audience resolution for email blasts — the channel-neutral mechanics
// (visibility scoping, dedupe, suppression batching) live in
// src/lib/outbound/audience.ts, extracted from src/lib/sms/audience.ts
// (OUTREACH-PHASE1-BRIEF.md §4). This file supplies only the email-specific
// contactability adapter: which lead column, how it normalizes, what counts
// as invalid. No "foreign number" analogue exists for email — do not invent one.

export type { ResolveAudienceClients };

export interface AudienceRow {
  leadId: string;
  email: string; // normalized (lowercased/trimmed) — what's actually sent to
  lead: Record<string, unknown>; // full row, for {{merge}} resolution
}

export interface AudienceBreakdown {
  matched: number; // leads the filter matched, before email/suppression exclusions
  sendable: AudienceRow[];
  // Recipients otherwise mailable but currently on the DNC list — /send
  // materializes these as auditable status='suppressed' email_messages rows
  // rather than silently dropping them.
  suppressed: AudienceRow[];
  excluded: {
    noEmail: number;
    malformed: number;
    suppressed: number;
    duplicateEmail: number;
  };
}

export type ResolveAudienceResult = { ok: true; audience: AudienceBreakdown } | { ok: false; errors: Record<string, string[]> };

// Same shape validation used by src/lib/email/sender.ts's isValidEmail —
// deliberately simple (not full RFC 5322), consistent with the rest of the
// outbound spine.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmailExcluded extends Record<string, number> {
  noEmail: number;
  malformed: number;
  suppressed: number;
  duplicate: number;
}

const emailAdapter: ChannelAdapter<string, EmailExcluded> = {
  contactOf: (lead) => (lead.email as string | null | undefined) ?? null,
  classify: (raw) => {
    if (!raw || !raw.trim()) return { ok: false, reason: "noEmail" };
    const normalized = normalizeEmail(raw);
    if (!EMAIL_RE.test(normalized)) return { ok: false, reason: "malformed" };
    return { ok: true, contact: normalized };
  },
  dedupeKey: (contact) => contact,
  loadSuppressed: loadSuppressedEmails,
  emptyExcluded: () => ({ noEmail: 0, malformed: 0, suppressed: 0, duplicate: 0 }),
};

export async function resolveAudience(
  auth: AuthContext,
  tree: FilterTree,
  clients: ResolveAudienceClients
): Promise<ResolveAudienceResult> {
  const result = await resolveAudienceCore(auth, tree, clients, emailAdapter);
  if (!result.ok) return result;

  const toRow = (r: { leadId: string; contact: string; lead: Record<string, unknown> }): AudienceRow => ({
    leadId: r.leadId,
    email: r.contact,
    lead: r.lead,
  });

  return {
    ok: true,
    audience: {
      matched: result.audience.matched,
      sendable: result.audience.sendable.map(toRow),
      suppressed: result.audience.suppressed.map(toRow),
      excluded: {
        noEmail: result.audience.excluded.noEmail,
        malformed: result.audience.excluded.malformed,
        suppressed: result.audience.excluded.suppressed,
        duplicateEmail: result.audience.excluded.duplicate,
      },
    },
  };
}
