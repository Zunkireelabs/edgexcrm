/**
 * One-off prod backfill — normalize `leads.destinations` (the column the "Preferred Study
 * Destination" table column reads) and fold in the 8 synonym custom_fields keys that were
 * never being read by that column at all.
 *
 * Two problems, one pass:
 *  1. `leads.destinations` itself already contains raw/unnormalized strings from a prior
 *     ad-hoc write (e.g. "Uk", "United Kingdom", "Dubai", "Australia | Canada" as one
 *     literal un-split string) — first dry-run showed additive-only merging would produce
 *     ugly duplicates like [UK, Uk] or [Dubai, UAE] sitting side by side.
 *  2. 8 different form fields (interested_country, countries, study_destination,
 *     dream_destination, preferred_study_destination, country, preferred_destination,
 *     matched_destination) captured the same answer under different JSON keys — only
 *     `preferred_study_destination` was ever read by the table column.
 *
 * So this does a full normalize-and-replace: every raw string, whether already sitting in
 * `destinations` or buried in one of the 8 custom_fields keys, goes through ONE explicit
 * lookup table built from the full distinct-value dump on prod (2026-07-25). No fuzzy/regex
 * guessing — anything not in the table is preserved as-is in the output (never dropped) and
 * reported as UNMAPPED so it gets a human look, in case new data landed since the snapshot.
 *
 * Decisions confirmed by Anish (2026-07-25):
 *  - "Austria" and "Austrilia" (typo) are different — Austria stays Austria, Austrilia -> Australia.
 *  - Extra real countries (Denmark, South Korea, UAE, Austria, Spain, Greece, Cyprus,
 *    Bangladesh) get stored on the lead but are NOT added to the DESTINATIONS dropdown taxonomy.
 *  - "🌍 Other" -> "Not decided".
 *  - "New Baneshwor" (a Kathmandu neighborhood, clearly the wrong field) -> "Not decided".
 *
 * Dry-run by default. Flags: --apply, --one (first changed lead only, canary).
 */
import { config } from "dotenv";
config({ path: ".env.local.prod" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIZZ = "febeb37c-521c-4f29-adbb-0195b2eede88";

const APPLY = process.argv.includes("--apply");
const ONE = process.argv.includes("--one");

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// Master raw-string -> canonical-destination(s) lookup. Union of every distinct value
// observed in `leads.destinations` itself AND across the 8 synonym custom_fields keys.
const RAW_TO_CANONICAL: Record<string, string[]> = {
  "Australia": ["Australia"], "australia": ["Australia"],
  "UK": ["UK"], "Uk": ["UK"], "uk": ["UK"], "United Kingdom": ["UK"],
  "USA": ["USA"], "usa": ["USA"], "U.S.A": ["USA"], "United States": ["USA"],
  "United States of America": ["USA"],
  "India": ["India"], "india": ["India"],
  "Germany": ["Germany"], "germany": ["Germany"],
  "Canada": ["Canada"], "canada": ["Canada"],
  "New Zealand": ["New Zealand"], "new_zealand": ["New Zealand"], "🇳🇿 New Zealand": ["New Zealand"],
  "Denmark": ["Denmark"], "denmark": ["Denmark"],
  "France": ["France"], "france": ["France"],
  "Dubai": ["UAE"], "UAE": ["UAE"], "uae": ["UAE"],
  "South Korea": ["South Korea"], "south Korea": ["South Korea"], "south_korea": ["South Korea"],
  "Finland": ["Finland"],
  "Austria": ["Austria"],
  "Europe": ["Europe"],
  "Spain": ["Spain"],
  "Nepal": ["Nepal"], "🇳🇵 Nepal": ["Nepal"],
  "Greece": ["Greece"],
  "Cyprus": ["Cyprus"],
  "Malta": ["Malta"],
  "Bangladesh": ["Bangladesh"],
  "🇬🇧 UK": ["UK"], "🇺🇸 USA": ["USA"], "🇨🇦 Canada": ["Canada"], "🇦🇺 Australia": ["Australia"],
  "🇮🇳 India": ["India"], "🇩🇪 Germany": ["Germany"], "🇫🇮 Finland": ["Finland"],
  "🌍 Other": ["Not decided"],
  "New Baneshwor": ["Not decided"],
  // Multi-value strings — the mapping table IS the parser, no delimiter-splitting logic needed.
  "UK | USA | Australia": ["UK", "USA", "Australia"],
  "US/Canada": ["USA", "Canada"],
  "UK/ Denmark/ Finland": ["UK", "Denmark", "Finland"],
  "New Zealand\t, Australia": ["New Zealand", "Australia"],
  "UK | Germany": ["UK", "Germany"],
  "Germany/UK": ["Germany", "UK"],
  "UK/Dubai": ["UK", "UAE"],
  "Australia, Sydney": ["Australia"],
  "Australia | Canada": ["Australia", "Canada"],
  "UK \nAustrilia": ["UK", "Australia"],
  "UK/USA/India": ["UK", "USA", "India"],
  "UK, Canada, Australia": ["UK", "Canada", "Australia"],
  "🇬🇧 UK, 🇮🇳 India, 🇩🇪 Germany": ["UK", "India", "Germany"],
  "🇬🇧 UK, 🇺🇸 USA, 🇦🇺 Australia": ["UK", "USA", "Australia"],
  "🇬🇧 UK, 🇨🇦 Canada, 🇺🇸 USA": ["UK", "Canada", "USA"],
  "🇬🇧 UK, 🇦🇺 Australia, 🇺🇸 USA": ["UK", "Australia", "USA"],
  "🇳🇿 New Zealand, 🇦🇺 Australia": ["New Zealand", "Australia"],
  "🇬🇧 UK, 🇦🇺 Australia": ["UK", "Australia"],
  "🇺🇸 USA, 🇩🇪 Germany": ["USA", "Germany"],
  "🇬🇧 UK, 🇩🇪 Germany": ["UK", "Germany"],
  "🇨🇦 Canada, 🇮🇳 India, 🇺🇸 USA": ["Canada", "India", "USA"],
  "Not decided": ["Not decided"],
};

const CUSTOM_FIELD_KEYS = [
  "interested_country", "countries", "study_destination", "dream_destination",
  "preferred_study_destination", "country", "preferred_destination", "matched_destination",
  "select_your_preferred_destination",
];

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  destinations: string[] | null;
  custom_fields: Record<string, unknown> | null;
};

function normalize(raw: string, unmapped: Set<string>, source: string): string[] {
  const hit = RAW_TO_CANONICAL[raw];
  if (hit) return hit;
  unmapped.add(`${source} :: ${JSON.stringify(raw)}`);
  return [raw]; // preserve unknown values as-is — never silently drop data
}

async function main() {
  if (!URL.includes("pirhnklvtjjpuvbvibxf")) throw new Error(`ABORT: not prod URL (${URL})`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}${ONE ? " (first changed lead only)" : ""}  DB: prod  Tenant: Admizz`);

  // PostgREST caps unpaginated selects at 1000 rows — Admizz has ~17k leads, so this
  // must page through explicitly or silently miss everything past the first page.
  const leads: LeadRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, first_name, last_name, destinations, custom_fields")
      .eq("tenant_id", ADMIZZ)
      .is("deleted_at", null)
      .order("id")
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    leads.push(...(data as LeadRow[]));
    if (data.length < PAGE) break;
  }
  console.log(`Fetched ${leads.length} leads`);

  let changed = 0;
  const unmapped = new Set<string>();

  for (const lead of leads) {
    const cf = lead.custom_fields ?? {};
    const before = [...(lead.destinations ?? [])];
    const canonical = new Set<string>();

    for (const raw of before) {
      for (const dest of normalize(raw, unmapped, "destinations")) canonical.add(dest);
    }
    for (const key of CUSTOM_FIELD_KEYS) {
      const raw = cf[key];
      if (typeof raw !== "string" || raw.trim() === "") continue;
      for (const dest of normalize(raw, unmapped, key)) canonical.add(dest);
    }

    const beforeSorted = [...before].sort().join(", ");
    const afterSorted = [...canonical].sort().join(", ");
    if (beforeSorted === afterSorted) continue;

    changed++;
    console.log(`${lead.first_name} ${lead.last_name ?? ""} (${lead.id})\n  before: [${beforeSorted}]\n  after:  [${afterSorted}]`);

    if (APPLY) {
      const { error: updErr } = await supabase
        .from("leads")
        .update({ destinations: [...canonical] })
        .eq("id", lead.id)
        .eq("tenant_id", ADMIZZ);
      if (updErr) console.error(`  UPDATE FAILED: ${updErr.message}`);
    }

    if (ONE) break;
  }

  console.log(`\n${APPLY ? "Applied" : "Would change"}: ${changed} leads`);
  if (unmapped.size > 0) {
    console.log(`\nUNMAPPED (${unmapped.size} distinct, preserved as-is, not canonicalized) — new raw values since 2026-07-25 snapshot:`);
    for (const u of unmapped) console.log(`  ${u}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
