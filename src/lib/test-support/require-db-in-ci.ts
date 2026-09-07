// Guard for the DB-backed suites (SMS credits/suppression/opt-out, email
// outbound send/suppression/unsubscribe).
//
// Those suites probe the local Supabase stack at 127.0.0.1:54321 and call
// ctx.skip() when it isn't up, which is right for a developer running
// `npm run test` without `supabase start`. It is wrong in CI: for weeks the
// Test job ran with no database at all, so ~26 tests covering SMS credit
// idempotency, suppression lists and opt-out skipped on every single run while
// the suite reported green. Review, not CI, caught the two HIGH credit-RPC bugs
// those tests exist to pin down — and the same silent-skip pattern is why the
// blast feature could be called complete and still fail at 16,000 recipients
// (docs/BLAST-FINDINGS-2026-09-06.md).
//
// So: skipping is fine wherever no database is promised, and a hard failure
// wherever one is. The switch is REQUIRE_LOCAL_DB, set ONLY by the
// "Test (database-backed)" job — deliberately not `CI`, which GitHub sets in
// every job including the plain `Test` one that has no database on purpose.
// If that job ever stops booting Supabase, this fails loudly instead of quietly
// reverting to the state it was built to fix.
export function requireLocalDbInCi(available: boolean, suite: string): void {
  if (available) return;
  if (!process.env.REQUIRE_LOCAL_DB) return; // no database promised here — skipping is correct
  throw new Error(
    `${suite}: the suite's setup probe failed while REQUIRE_LOCAL_DB is set. ` +
      `Either the local Supabase stack is unreachable at 127.0.0.1:54321, or it is up but ` +
      `missing the fixture row the probe reads. DB-backed suites must never silently skip ` +
      `where a database was promised — the "Test (database-backed)" job owns that setup ` +
      `(supabase start -> db reset -> scripts/migrate-apply.sh local -> ` +
      `scripts/local-db-setup.sh -> lead fixture). Fix the job; do not relax this guard.`
  );
}
