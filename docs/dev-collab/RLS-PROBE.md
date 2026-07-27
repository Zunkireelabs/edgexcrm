# RLS Probe — proving cross-tenant isolation under a real session

`scripts/rls-probe.ts` is a runnable, LOCAL-ONLY script that proves Row Level
Security on `leads` actually blocks cross-tenant access **under a real
authenticated session** — the anon-key + user-JWT path (browser client,
PostgREST, any future direct-client feature). It is infra tooling, not a
Vitest test: it does not run as part of `npm run test` or CI.

## Why this exists

The app's primary tenant-isolation defense is application code —
`scopedClient(auth)` / explicit `.eq("tenant_id", ...)` — running on the
**service-role client**, which bypasses RLS entirely (see `CLAUDE.md` §
Tenant Isolation Rules). RLS on the tables is the *secondary* defense that
only matters on paths that hit Supabase through the anon key + a signed-in
user's JWT.

That secondary defense had zero automated coverage, and the project has
already been burned once by checking RLS the wrong way: a whole debugging
cycle on the branch-manager/admin branch-switcher "0 leads" bug was wasted
because every check used service-role SQL/REST, which returned the expected
rows while the real (RLS-enforced) app path returned zero — root cause was
an RLS policy on `tenant_users` zeroing a membership sub-lookup, invisible
to service-role tools. The rule from that incident, restated in
`DEV-WORKFLOW-AND-DEPLOYMENT.md` and `LOCAL-DEV-SETUP.md` § 4: **"Verify in
`npm run dev` as a real logged-in user — RLS only shows up under a real
JWT."** This script automates that verification for `leads` instead of
relying on someone remembering to do it by hand.

## How to run

```bash
supabase start                          # local Supabase stack up
scripts/migrate-apply.sh local          # local DB current with merged migrations
npx tsx scripts/rls-probe.ts            # run the probe
npx tsx scripts/rls-probe.ts --cleanup  # tear down the two probe tenants/users/leads
```

The script refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` (from
`.env.local`) matches `127.0.0.1`/`localhost` — it provisions and deletes
tenants, users, and leads, and signs in as them, so it must never be pointed
at stage or prod.

It is idempotent: re-running without `--cleanup` reuses the same fixture
tenants (`rls-probe-a` / `rls-probe-b`, upserted by slug), users
(`rls-probe-a@edgex.local` / `-b`, created once then recovered by sign-in on
later runs), and marker leads (upserted by `(tenant_id, idempotency_key)`).
Exits non-zero if any probe fails, so it can become a CI gate later without
changes to the pass/fail contract.

## What it proves

Two distinct Supabase clients are used, and the distinction between them
**is** the test:

- `serviceClient` — service-role key. Bypasses RLS. Used only for fixture
  setup and as the anti-false-green control.
- `userClient(accessToken)` — anon key + `Authorization: Bearer
  <signed-in user's JWT>`. This is the only client in the script that is
  actually subject to RLS, and every probe assertion runs through it.

Fixtures: two tenants (A, B), one owner user per tenant, one pipeline per
tenant (`leads.pipeline_id` is `NOT NULL`), one marker lead per tenant
(`idempotency_key = 'rls-probe-marker'`, unique per `(tenant_id,
idempotency_key)` so both tenants can reuse the same key value).

Probes, all run as tenant A's user through `userClient`:

1. **Cross-tenant SELECT** — `select * from leads` returns A's marker, never
   B's.
2. **Direct-by-id** — `select * from leads where id = <B's lead id>` returns
   0 rows (RLS filters by tenant regardless of how specific the query is).
3. **Cross-tenant write** — insert a lead with `tenant_id = B` is rejected;
   update on B's lead affects 0 rows, and the row's `status` is confirmed
   unchanged via the service-role client afterward.
4. **CONTROL (anti-false-green), mandatory** — three checks that exist
   specifically so a broken RLS policy can't produce a false PASS:
   - The service-role client sees **both** tenants' markers, proving the
     cross-tenant data genuinely exists — so probe 1's "B is absent" means
     RLS blocked it, not that B's row never existed.
   - The probe session's JWT `role` claim is asserted to be `authenticated`,
     not `service_role` — decoded straight from the JWT payload. If a probe
     ever accidentally ran on a privileged session, every prior assertion
     would be meaningless; this catches that class of bug directly.
   - User A's own query result is compared against the service-role
     control's result. If they matched (same rows), the script fails loudly
     with an explicit "this probe is NOT RLS-enforcing" message instead of
     reporting the earlier probes as passing.

## Real finding from the first run (not smoothed over)

Probe 3a ("cross-tenant INSERT into tenant B rejected") passes, but the
rejection is **not** cross-tenant-specific: `leads` has no RLS policy at all
that grants `INSERT` to the `authenticated` role — only `TO anon`. An
authenticated user's insert into their **own** tenant is rejected with the
identical `new row violates row-level security policy for table "leads"`
error (verified by hand during this build, not just asserted). This matches
the app's actual architecture — the public form path inserts as `anon`, and
every authenticated "create a lead" path in the app goes through an API
route on the service-role client, never a direct client-side insert — so it
is not a functional bug. But it does mean probe 3a is weaker evidence than
it looks: it proves "authenticated users cannot INSERT into `leads` at all
today," not "cross-tenant INSERT is specifically the thing being blocked."
If a future feature ever adds a direct authenticated-client insert path to
`leads` (bypassing the API-route pattern), it would need its own
tenant-scoped `WITH CHECK` policy, and this probe would need a same-tenant
positive-insert case added to actually distinguish the two.

## `anon` role coverage — closed by migration 186

Every probe up through Probe 4 runs as the **`authenticated`** role (anon key
+ a signed-in user's JWT). Probe 5 covers the bare **`anon`** role — the
public anon key with *no* user JWT, which is the role the embeddable
widget/public form uses and which is readable from any published form's
browser bundle.

Until migration `186_drop_anon_leads_policies.sql`, this was a real gap, not
a theoretical one: `leads` carried three permissive `TO anon` policies from
`001_initial_schema.sql` (`FOR SELECT USING (true)`, `FOR UPDATE USING (true)
WITH CHECK (true)`, `FOR INSERT WITH CHECK (true)`) that no earlier migration
dropped, plus table-level `anon` grants. A bare-anon `GET
/rest/v1/leads?select=*` returned leads across **all** tenants — confirmed on
local (1,094 rows spanning multiple tenants), stage, and prod (17,943 leads)
before the fix.

Migration 186 dropped all three `TO anon` policies and `REVOKE ALL ON
public.leads FROM anon` (defense in depth, so a future policy added `TO anon`
can't silently reopen the door without also re-granting). Probes 5a-5c below
are the regression test that landed in the same change:

5. **Bare-anon role** — a client built from the anon key with no
   `Authorization` override (contrast with `userClient`, which carries a
   signed-in user's Bearer JWT):
   - **5a** — SELECT on `leads` returns 0 rows (now a hard "permission denied"
     from the revoked grant, not merely an RLS-filtered empty set).
   - **5b** — INSERT into any tenant is rejected.
   - **5c** — UPDATE of a tenant's lead affects 0 rows, verified unchanged via
     the service-role client afterward.
   - **5d** — CONTROL, mirroring Probe 4b: the bare-anon client's effective
     role decodes to `anon`, not `authenticated`, so this can't false-green by
     accidentally carrying a signed-in user's JWT.

## Sample output (local, 2026-07-26, post mig 186)

```
Target: http://127.0.0.1:54321

Fixture A: tenant=657a846d-... user=0f649e5d-... lead=a19ad91a-...
Fixture B: tenant=f3028b6a-... user=505cf2d4-... lead=2f5deecc-...

--- Probes (running as tenant A's user, through anon-key + JWT) ---

PASS — Probe 1 — cross-tenant SELECT filters out tenant B (rows=1)
PASS — Probe 2 — direct select-by-id on tenant B's lead returns 0 rows
PASS — Probe 3a — cross-tenant INSERT into tenant B rejected (new row violates row-level security policy for table "leads")
PASS — Probe 3b — cross-tenant UPDATE of tenant B's lead affects 0 rows
PASS — Probe 3b (verify) — tenant B's lead status unchanged after A's update attempt (status=new)
PASS — Probe 4a — CONTROL: service-role sees both tenants' markers (rows=2)
PASS — Probe 4b — CONTROL: probe session JWT role is 'authenticated', not service_role (role=authenticated)
PASS — Probe 4c — CONTROL: user A's result differs from service-role's (RLS is actually filtering)

--- Probes (running as bare anon — no signed-in user, no Bearer JWT) ---

PASS — Probe 5d — CONTROL: bare-anon client carries no user Authorization header (role='anon', not 'authenticated') (role=anon)
PASS — Probe 5a — bare-anon SELECT on leads returns 0 rows (permission denied for table leads)
PASS — Probe 5b — bare-anon INSERT into tenant A rejected (permission denied for table leads)
PASS — Probe 5c — bare-anon UPDATE of tenant A's lead affects 0 rows (permission denied for table leads)
PASS — Probe 5c (verify) — tenant A's lead status unchanged after bare-anon update attempt (status=new)

13 passed, 0 failed.
```

## CI integration — NOT done, tracked as a deliberate follow-up

This script is **not** wired into any CI workflow and does **not** run on
`npm run test`, `stage`, or `main` today. Making it a required-blocking gate
needs a `supabase start` (or equivalent Docker-in-CI) job in GitHub Actions
to give it a real local-shaped Postgres + PostgREST + GoTrue stack to run
against — CI runners don't have that today. This is a deferred decision, not
an oversight: track it alongside the other Phase-5 isolation-gate follow-ups
before treating "RLS is covered" as true for `stage`/`main` pushes, only for
a developer who runs it locally.
