# Brief for Sonnet — Admizz open work (2 code tasks, STAGE only)

**Context:** Final two items from the Admizz migration QC. Both are code changes (+ one small stage data backfill). Work on a branch against **stage** (`dymeudcddasqpomfpjvt`).

**Hard rules (unchanged):**
- Stage only. Do **NOT** touch prod DB (`pirhnklvtjjpuvbvibxf`) or apply anything to prod.
- Do **NOT** merge, deploy, or push beyond your feature branch.
- Report diffs + before/after evidence + `npm run build` + `npx eslint --max-warnings 50`, then **STOP for Opus review.**

Stage connection: `host=db.dymeudcddasqpomfpjvt.supabase.co port=5432 user=postgres dbname=postgres sslmode=require`, password `Zunkiree@123%^&` (pgcrypto in `extensions` schema).

---

## Task A — Leads list still capped at 1,000 (the real fix: chunked fetch)

**Why the previous fix didn't work:** raising `getLeads`' `.limit()` to 20,000 has no effect because **Supabase PostgREST caps every response at `max-rows = 1000`** server-side. Proven: a 5,000-row request returns `content-range: 0-999/6531`. `.limit()` cannot exceed the server cap.

**Fix — paginate the fetch inside `getLeads`** (`src/lib/supabase/queries.ts`, ~line 82–110): fetch in **1,000-row chunks via `.range()`** and concatenate until a chunk returns `< 1000` rows or the requested `limit` is reached.

Implementation notes:
- Compute the `restrictToSelf` / `branchId` id-lists **once** (they're async), then apply the same filters on every chunk.
- Add a **stable sort** before ranging so chunks don't overlap/skip — e.g. `.order("created_at", { ascending: false }).order("id", { ascending: false })`. (The table re-sorts client-side, so server order only needs to be deterministic.)
- Replace the single `.limit(scope?.limit ?? 1000)` with the chunk loop; `scope.limit` (the leads page already passes `20000`) becomes the **ceiling**, not the page size. `CHUNK = 1000`.
- Shape:
  ```ts
  const CHUNK = 1000;
  const max = scope?.limit ?? 1000;
  const out: Lead[] = [];
  for (let from = 0; from < max; from += CHUNK) {
    const to = Math.min(from + CHUNK, max) - 1;
    const { data, error } = await buildQuery().range(from, to);   // buildQuery applies all filters + stable order
    if (error) break;
    out.push(...(data ?? []) as Lead[]);
    if (!data || data.length < CHUNK) break;
  }
  return out;
  ```
- Keep the `// TEMPORARY` note: this loads the whole list into the client; **proper server-side pagination remains the real roadmap fix.** Do not attempt that refactor here.

**Verify:** on local `npm run dev` as Admizz admin (`admizzdotcom2020@gmail.com` / `admizz123`) → Migration (QC) list shows **~6,114** (footer "Showing 1-25 of 6114"), not 1000. Spot-check one counselor filter returns their full assigned count.

---

## Task B — Show member names instead of email / "Unknown"

Today the team & org screens label members by **email** (and "Unknown" when email is missing). Make them show the person's **name**, falling back to email.

### B1. APIs return a `name`
Both routes map `user_id → email` from `auth.admin.listUsers()`. Add the display name from `user.user_metadata` (`name` ?? `full_name`) and return it.
- `src/app/(main)/api/v1/team/route.ts` (~line 54–70): also build a name map; add `name: nameMap.get(m.user_id) ?? null` to each enriched member.
- `src/app/(main)/api/v1/org-layers/route.ts` (~line 55–62): same — add `name` to the `OrgMember` shape (interface ~line 19) and the member object.
- **Paginate `listUsers`** while you're here: call it with `{ perPage: 1000 }` (or loop pages until a page returns `< perPage`) so it doesn't silently miss users as the tenant grows. (Today there are 37 users; this is future-proofing.)

### B2. UI renders `name || email`
- `src/components/dashboard/team-management.tsx` (~line 313–317): avatar initial and label use `member.name || member.email`.
- `src/components/dashboard/org-structure/position-card.tsx` (lines ~99–153) and `unassigned-members-tray.tsx` (~47–55): render `m.name || m.email`; avatar/`title` likewise.
- Add `name?: string | null` to the relevant member types (`TeamMember`, `OrgMember`).

### B3. Backfill staff names on stage (data)
The 4 interns already carry `user_metadata.name`. The mirrored staff (SN 0–13) carry none. Backfill from the credentials sheet by **merging** a `name` key (don't clobber other metadata). Only update emails that exist.
```sql
update auth.users u set raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || jsonb_build_object('name', v.name)
from (values
  ('admizzdotcom2020@gmail.com','Admizz Admin'),
  ('manish.sah@admizz.com','Manish K Sah'),
  ('mamata.sah@admizz.org','Mamata Sah'),
  ('bijay.dahal@admizz.org','Bijay Dahal'),
  ('kamana.admizz@gmail.com','Kamana'),
  ('purnima.admizz@gmail.com','Purnima'),
  ('amit.rawal@admizz.org','Amit Rawal'),
  ('gautam.ray@admizz.org','Gautam Ray'),
  ('nikhil.mirdha@admizz.org','Nikhil Mirdha'),
  ('diplov.karn@admizz.org','Diplov Karn'),
  ('dikshyaadmizz@gmail.com','Dikshya'),
  ('samriti.admizz@gmail.com','Samriti'),
  ('umesh.chaudhary@admizz.org','Umesh Chaudhary'),
  ('manish.jnk@admizz.org','Manish Sah-Janakpur')
) as v(email,name)
where u.email = v.email;
```
Report how many rows updated (emails not present in stage simply won't match — note them).

**Verify:** team & org pages show real names (e.g. "Amit Rawal", "Simrika"); any member still lacking a name falls back to email (no "Unknown" unless both are truly absent).

---

## Prod-replay note (for the future prod brief — not this task)
- Create interns SN 14–17 on prod via the **Supabase Admin API (`createUser`)**, never raw SQL insert (raw insert leaves NULL token columns → `listUsers` 500s for *all* prod tenants). Use the sheet passwords + set `user_metadata.name`.
- Re-run the B3 name backfill on prod for SN 0–13 (they already exist there).

---

## Definition of done (report back, then STOP)
- Task A: `getLeads` diff; confirmation the Migration list loads ~6,114 locally; one counselor-filter spot-check.
- Task B: API + UI diffs; backfill row count; screenshot/confirmation names render with email fallback.
- `npm run build` clean; `npx eslint --max-warnings 50` clean. No merge, no deploy, no prod writes.
