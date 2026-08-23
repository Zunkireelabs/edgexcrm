// TEST-ONLY helper. Not imported by any production code path.
//
// Minimal re-implementation of scopedClientForTenant() (src/lib/supabase/
// scoped.ts) against a directly-created local Supabase client, since the real
// createServiceClient() reads env vars a bare `vitest` process doesn't have
// (see src/lib/sms/optout.test.ts's identical precedent). Mirrors the real
// wrapper's tenant-injection semantics exactly so behavior under test matches
// production.

import { createClient } from "@supabase/supabase-js";
import type { ScopedClient } from "@/lib/supabase/scoped";

export const LOCAL_API_URL = "http://127.0.0.1:54321";
// Static, well-known LOCAL Supabase demo service-role key (safe to commit —
// local only). Same key scripts/local-db-setup.sh uses.
export const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const raw = createClient(LOCAL_API_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export function localRawClient() {
  return raw;
}

function stripTenantId<T extends Record<string, unknown>>(row: T): Omit<T, "tenant_id"> {
  const safe = { ...row } as Partial<T> & { tenant_id?: unknown };
  delete safe.tenant_id;
  return safe as Omit<T, "tenant_id">;
}

export function localScopedClient(tenantId: string): ScopedClient {
  function from(table: string) {
    return {
      select(columns: string = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
        const base = raw.from(table);
        const q = options ? base.select(columns, options) : base.select(columns);
        return q.eq("tenant_id", tenantId);
      },
      update(values: Record<string, unknown>) {
        const safe = stripTenantId(values);
        return raw.from(table).update(safe).eq("tenant_id", tenantId);
      },
      delete() {
        return raw.from(table).delete().eq("tenant_id", tenantId);
      },
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        const withTenant = Array.isArray(rows)
          ? rows.map((r) => ({ ...stripTenantId(r), tenant_id: tenantId }))
          : { ...stripTenantId(rows), tenant_id: tenantId };
        return raw.from(table).insert(withTenant);
      },
      upsert(
        rows: Record<string, unknown> | Record<string, unknown>[],
        options: { onConflict: string; ignoreDuplicates?: boolean }
      ) {
        const withTenant = Array.isArray(rows)
          ? rows.map((r) => ({ ...stripTenantId(r), tenant_id: tenantId }))
          : { ...stripTenantId(rows), tenant_id: tenantId };
        return raw.from(table).upsert(withTenant, options);
      },
    };
  }

  function fromGlobal(table: string) {
    return raw.from(table);
  }

  return {
    from,
    fromGlobal,
    rpc(fn: string, args: Record<string, unknown> = {}) {
      return raw.rpc(fn, { ...args, p_tenant_id: tenantId });
    },
    raw: () => raw,
  } as unknown as ScopedClient;
}
