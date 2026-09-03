/**
 * Interim Orca access gate — OWNER ONLY (narrower than requireAdmin) for the
 * first Admizz prod exposure (migration 174 required "Admizz last, and only
 * after written client consent"; Sadin wants the first prod exposure limited
 * to owners — Admizz has 2 owners + 1 admin, and the admin should not see
 * Orca yet).
 *
 * Deliberately NOT requireAdmin(): that predicate serves 162 call sites,
 * ~155 of them unrelated to AI — narrowing it would lock admins out of
 * unrelated routes. Same reasoning rules out narrowing isLayoutAdmin
 * (also gates Leads Organise staging buckets) or isSettingsAdmin (gates
 * every settings tab). This is a NEW predicate applied only at Orca gate
 * sites.
 *
 * Zero imports on purpose: this module is pulled into client bundles
 * (shell.tsx, the settings registry) as well as server code, so it must not
 * transitively drag in `next/headers` / the service client the way
 * `@/lib/ai/flag` does.
 *
 * Replace this whole function when per-user AI access levels are built.
 */
export function requireOrcaAccess(role: string): boolean {
  return role === "owner";
}
