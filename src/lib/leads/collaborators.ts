import type { SupabaseClient } from "@supabase/supabase-js";

// Max collaborator lead-ids to inline into an OR filter on the leads table.
// Inline id.in.(...) overflows Node/undici's ~16 KB URL limit around 440 ids, so
// cap well below. Older collaborated leads beyond this cap stay reachable via the
// single-lead path (detail page / global search), which has no URL-length issue.
const INLINE_ID_CAP = 300;

/**
 * Record that a user has engaged with (been assigned to) a lead. The row persists
 * even after the lead is reassigned, so the user keeps view access. Idempotent;
 * no-op when userId is null/undefined.
 */
export async function addLeadCollaborator(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  await db.from("lead_collaborators").upsert(
    { tenant_id: tenantId, lead_id: leadId, user_id: userId },
    { onConflict: "lead_id,user_id", ignoreDuplicates: true },
  );
}

/** Bulk variant — record one collaborator across many leads in a single upsert. */
export async function addLeadCollaborators(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[],
  userId: string | null | undefined,
): Promise<void> {
  if (!userId || leadIds.length === 0) return;
  await db.from("lead_collaborators").upsert(
    leadIds.map((lead_id) => ({ tenant_id: tenantId, lead_id, user_id: userId })),
    { onConflict: "lead_id,user_id", ignoreDuplicates: true },
  );
}

/**
 * Lead IDs this user has ever been engaged with (most-recent first), capped for
 * URL safety. Merge with the assignee filter to widen own-scope visibility:
 *   const extra = [...new Set([...sharedIds, ...collabIds])];
 *   if (extra.length) q.or(`assigned_to.eq.${userId},id.in.(${extra.join(",")})`)
 */
export async function collaboratorLeadIdsForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const { data } = await db.from("lead_collaborators")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(INLINE_ID_CAP);
  return (data ?? []).map((r: { lead_id: string }) => r.lead_id);
}

// PostgREST returns at most this many rows per request (its `max-rows` default) and does
// NOT error when it truncates — a result of exactly this size therefore means "there may be
// more", never "that's all". Every multi-row read below pages until a short page comes back.
const POSTGREST_PAGE = 1000;

/**
 * Collaborators for a specific set of leads, keyed by lead_id — exact, with no global cap.
 * Chunks the id list (PostgREST URL limit ~440 ids) and runs chunks in parallel; each chunk
 * is then PAGED, because 300 leads can easily carry more than 1,000 collaborator rows
 * (rows persist forever — every reassignment adds one) and a single request would silently
 * drop the tail, making those people's leads vanish from client-side Collaborators filters.
 * (Replaces the old tenant-wide getLeadCollaboratorsMap, whose 10,000-row cap did the same.)
 */
export async function getLeadCollaboratorsMapForLeads(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[],
): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  if (leadIds.length === 0) return map;
  const CHUNK = 300;
  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += CHUNK) chunks.push(leadIds.slice(i, i + CHUNK));

  const fetchChunk = async (slice: string[]) => {
    const rows: { lead_id: string; user_id: string }[] = [];
    for (let from = 0; ; from += POSTGREST_PAGE) {
      const { data } = await db.from("lead_collaborators")
        .select("lead_id, user_id")
        .eq("tenant_id", tenantId)
        .in("lead_id", slice)
        // Deterministic order — without it, range() pages of an unordered scan can
        // skip/duplicate rows between requests.
        .order("lead_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, from + POSTGREST_PAGE - 1);
      const page = (data ?? []) as { lead_id: string; user_id: string }[];
      rows.push(...page);
      if (page.length < POSTGREST_PAGE) return rows;
    }
  };

  const results = await Promise.all(chunks.map(fetchChunk));
  results.forEach((rows) => {
    rows.forEach((r) => {
      (map[r.lead_id] ??= []).push(r.user_id);
    });
  });
  return map;
}

/** Targeted single-lead check — is this user a collaborator on this lead? */
export async function isLeadCollaborator(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await db.from("lead_collaborators")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
