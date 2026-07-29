// Tenant resolution — the ONLY path from a raw inbound envelope to a tenant.
// Brief §8: tenant comes from the recipient token and nothing else — never
// `From:`, never a header, never the body. Candidates are to ∪ cc ∪ bcc;
// each is checksum-verified (tokens.ts) before ever touching the DB, and the
// matched `inbound_addresses` row IS the authorization — it carries
// tenant_id, thread_id, user_id.

import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, INBOUND_TOKEN_LIMIT } from "@/lib/api/rate-limit";
import { parseInboundAddress, type InboundVerb } from "./tokens";

export interface ResolvedInboundAddress {
  id: string;
  tenantId: string;
  kind: "thread" | "user" | "tenant";
  verb: InboundVerb;
  token: string;
  threadId: string | null;
  userId: string | null;
}

export interface ResolveRecipientsResult {
  /** One entry per matched, active, non-rate-limited address — independently tenant-scoped. */
  matches: ResolvedInboundAddress[];
  /**
   * True when at least one candidate parsed to a well-formed, checksum-valid
   * token but resolved to no active DB row (revoked/unknown) or was
   * rate-limited. Distinguishes "junk recipient, ignore" from "a real token
   * that deserves a dead-letter row" for the caller.
   */
  hadCandidateButNoMatch: boolean;
}

export async function resolveInboundRecipients(candidates: {
  to: string[];
  cc: string[];
  bcc: string[];
}): Promise<ResolveRecipientsResult> {
  const allAddresses = [...candidates.to, ...candidates.cc, ...candidates.bcc];

  // Dedupe by token — a token cc'd to itself twice should resolve once.
  const tokensByVerb = new Map<string, InboundVerb>();
  for (const addr of allAddresses) {
    const parsed = parseInboundAddress(addr);
    if (parsed) tokensByVerb.set(parsed.token, parsed.verb);
  }

  if (tokensByVerb.size === 0) {
    return { matches: [], hadCandidateButNoMatch: false };
  }

  const supabase = await createServiceClient();
  const matches: ResolvedInboundAddress[] = [];
  let hadCandidateButNoMatch = false;

  for (const token of tokensByVerb.keys()) {
    // Bound the blast radius of a leaked token (brief §8) before spending a DB query on it.
    const rate = await checkRateLimit(`inbound_addr:${token}`, INBOUND_TOKEN_LIMIT);
    if (!rate.allowed) {
      hadCandidateButNoMatch = true;
      continue;
    }

    const { data } = await supabase
      .from("inbound_addresses")
      .select("id, tenant_id, kind, verb, token, thread_id, user_id, status")
      .eq("token", token)
      .eq("status", "active")
      .maybeSingle();

    if (!data) {
      hadCandidateButNoMatch = true;
      continue;
    }

    const row = data as {
      id: string;
      tenant_id: string;
      kind: "thread" | "user" | "tenant";
      verb: InboundVerb;
      token: string;
      thread_id: string | null;
      user_id: string | null;
    };

    matches.push({
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind,
      verb: row.verb,
      token: row.token,
      threadId: row.thread_id,
      userId: row.user_id,
    });
  }

  return { matches, hadCandidateButNoMatch };
}
