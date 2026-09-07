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
// So: skipping is fine locally, and a hard failure in CI. If the
// "Test (database-backed)" job ever stops booting Supabase, this fails loudly
// instead of quietly reverting to the state it was built to fix.
export function requireLocalDbInCi(available: boolean, suite: string): void {
  if (available) return;
  if (!process.env.CI) return; // local dev without `supabase start` — skipping is correct
  throw new Error(
    `${suite}: local Supabase is unreachable at 127.0.0.1:54321, but CI=true. ` +
      `DB-backed suites must never silently skip in CI — the "Test (database-backed)" job ` +
      `is responsible for booting the stack (supabase start -> db reset -> ` +
      `scripts/migrate-apply.sh local -> scripts/local-db-setup.sh). ` +
      `Fix the job; do not relax this guard.`
  );
}
