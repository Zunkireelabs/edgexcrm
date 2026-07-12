import { createLookupTableListRoutes } from "@/lib/api/lookup-table-routes";

// Migration 139 one-time-seeded current..+9 years. Unlike intake_months (a
// fixed 12-name calendar set that never needs upkeep), years must keep
// extending forever or this table silently goes stale until an admin
// remembers to add the next one. Self-heal on every admin GET instead — but
// only ever EXTEND the top of the window (insert years above whatever the
// tenant's current highest existing year is), never backfill from scratch.
// A full current..+9 re-upsert every time would silently recreate any year
// an admin explicitly deleted (e.g. discontinuing an old cohort) the moment
// the list next loads. Extending only the top still keeps the window
// rolling forward automatically, while a deliberate delete of an older/
// mid-range year is respected and stays deleted.
export const { GET, POST } = createLookupTableListRoutes({
  table: "intake_years",
  itemLabel: "intake year",
  routePath: "/api/v1/intake-years",
  ensureFreshRows: async (db) => {
    const currentYear = new Date().getFullYear();
    const targetMaxYear = currentYear + 9;
    const { data: existing } = await db.from("intake_years").select("name");
    const existingYears = ((existing ?? []) as unknown as { name: string }[])
      .map((r) => Number(r.name))
      .filter((n) => Number.isFinite(n));
    const maxExisting = existingYears.length > 0 ? Math.max(...existingYears) : currentYear - 1;
    if (maxExisting >= targetMaxYear) return;
    const rows = [];
    for (let y = maxExisting + 1; y <= targetMaxYear; y++) rows.push({ name: String(y) });
    await db.from("intake_years").upsert(rows, { onConflict: "tenant_id,name", ignoreDuplicates: true });
  },
});
