import { stripDecoration } from "./destination-normalize";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Shared write-time guard for the 3 tenant-managed catalog tables that feed
// destination/course/study-level dropdowns (`countries`, `courses`,
// `study_levels`). These are admin-typed free text, same as any form field,
// so they carry the same risk destination-normalize.ts exists for: a flag
// emoji or stray whitespace/case makes a new row LOOK like a duplicate of an
// existing one without the DB's exact-match unique constraint catching it.
// normalizeDestinations() etc. clean values on the way onto a lead, but that
// can't undo a decorated/duplicate row that was already let into the catalog
// itself — this cleans it at the one point that actually prevents it: creation.
export function normalizeCatalogName(raw: unknown): string {
  return stripDecoration(String(raw ?? ""));
}

// Case-insensitive existence check scoped to the caller's already-tenant-scoped
// `db` client. `.ilike()` with no `%`/`_` wildcards in the pattern is an exact
// case-insensitive match, not a substring search. Pass `excludeId` on an update
// so a row doesn't collide with its own unchanged name.
export async function findCatalogNameConflict(
  db: ScopedClient,
  table: "countries" | "courses" | "study_levels",
  name: string,
  excludeId?: string,
): Promise<boolean> {
  let query = db.from(table).select("id").ilike("name", name);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.limit(1);
  return Array.isArray(data) && data.length > 0;
}
