import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeDestinations, normalizeDestinations } from "@/lib/leads/destination-normalize";

// Server side of the destination case fix (client report, Manish / Admizz, Nov 2026 — a lead from the Nepal-UK form was
// saved with "uk" / "nepal" while the tenant's catalog spells "UK" / "Nepal", so nothing matched in the UI).
//
// Every path that WRITES a lead's destinations (public form submit, lead create, lead edit) runs the values through
// canonicalizeDestinationsForTenant(): they come out in the tenant's OWN catalog spelling (Settings → Destination
// Countries = the `countries` table). Values the catalog doesn't know are kept as cleaned — never rewritten to a
// hardcoded spelling, never dropped.
//
// FAIL-SAFE by design: this runs on the public form hot path, so a catalog lookup that errors, throws or returns
// nothing must NEVER block or alter a submission — it silently falls back to exactly the old normalizeDestinations().

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; names: string[] }>();

/** Test hook — the cache is module-level. */
export function resetDestinationCatalogCache(): void {
  cache.clear();
}

/** The tenant's active destination countries, in the catalog's spelling. [] on any failure (never throws). */
export async function loadDestinationCatalog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
): Promise<string[]> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  try {
    const { data, error } = await supabase
      .from("countries")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    if (error || !Array.isArray(data)) return []; // a failure is NOT cached — the next call retries
    const names = (data as Array<{ name?: unknown }>)
      .map((r) => r.name)
      .filter((n): n is string => typeof n === "string" && n.trim() !== "");
    cache.set(tenantId, { at: Date.now(), names });
    return names;
  } catch {
    return [];
  }
}

/** Cleans + re-spells destinations against the tenant's catalog. Falls back to plain normalizeDestinations() on failure. */
export async function canonicalizeDestinationsForTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  values: readonly string[],
): Promise<string[]> {
  const cleaned = normalizeDestinations([...values]);
  if (cleaned.length === 0) return cleaned; // nothing to match — skip the lookup
  const catalog = await loadDestinationCatalog(supabase, tenantId);
  return canonicalizeDestinations(cleaned, catalog);
}
