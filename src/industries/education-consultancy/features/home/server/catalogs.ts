import type { ScopedClient } from "@/lib/supabase/scoped";
import { DESTINATIONS, FIELDS_OF_STUDY } from "@/industries/_shared/features/lead-lists/taxonomies";

export interface TenantCatalogs {
  countries: string[];
  fieldsOfStudy: string[];
}

const NOT_DECIDED = "Not decided";

/**
 * The tenant's OWN country and field-of-study lists (Settings: `countries`, `courses`), active rows only. A tenant that has
 * configured none falls back to the same built-in lists the dropdowns fall back to (useEduTaxonomy), so Orca and the form
 * always agree. "Not decided" is never something Orca can write.
 */
export async function loadTenantCatalogs(db: ScopedClient): Promise<TenantCatalogs> {
  const names = async (table: "countries" | "courses"): Promise<string[]> => {
    const { data } = await db.from(table).select("name").eq("is_active", true).order("name", { ascending: true });
    return ((data ?? []) as unknown as Array<{ name: string }>).map((r) => r.name).filter((n) => n && n !== NOT_DECIDED);
  };
  const [countries, courses] = await Promise.all([names("countries").catch(() => []), names("courses").catch(() => [])]);
  return {
    countries: countries.length ? countries : DESTINATIONS.filter((d) => d !== NOT_DECIDED),
    fieldsOfStudy: courses.length ? courses : FIELDS_OF_STUDY.filter((d) => d !== NOT_DECIDED),
  };
}
