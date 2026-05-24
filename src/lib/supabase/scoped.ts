/**
 * Tenant-scoped Supabase client wrapper.
 *
 * Eliminates the "forgot to add `.eq('tenant_id', auth.tenantId)`"
 * trap that exists across ~37 authenticated routes today. Wraps the
 * service-role client and auto-applies tenant filters on every query
 * for tenant-owned tables.
 *
 * Usage in a new authenticated API route:
 *
 *   const auth = await authenticateRequest();
 *   if (!auth) return apiUnauthorized();
 *   const db = await scopedClient(auth);
 *
 *   const { data, error } = await db.from("leads").select("*");
 *   //                              ^ tenant filter auto-applied
 *
 *   const { data: created } = await db
 *     .from("leads")
 *     .insert({ first_name: "Ada", email: "a@b.com" });
 *   //   ^ tenant_id auto-injected
 *
 * For cross-tenant operations (admin tasks), use `db.raw()` to get
 * back the unwrapped service client. The naming is intentional —
 * `raw()` makes the escape hatch impossible to use accidentally.
 *
 * Migration of legacy routes that use `createServiceClient()` + manual
 * `.eq("tenant_id", ...)` to this wrapper is tracked on STATUS-BOARD
 * as ongoing hardening work.
 */

import { createServiceClient } from "./server";
import type { AuthContext } from "@/lib/api/auth";

type RawClient = Awaited<ReturnType<typeof createServiceClient>>;

export async function scopedClient(auth: AuthContext) {
  const raw = await createServiceClient();

  function from(table: string) {
    const builder = raw.from(table);
    return {
      select(columns?: string) {
        const q = columns ? builder.select(columns) : builder.select("*");
        return q.eq("tenant_id", auth.tenantId);
      },
      update(values: Record<string, unknown>) {
        return builder.update(values).eq("tenant_id", auth.tenantId);
      },
      delete() {
        return builder.delete().eq("tenant_id", auth.tenantId);
      },
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        const withTenant = Array.isArray(rows)
          ? rows.map((r) => ({ ...r, tenant_id: auth.tenantId }))
          : { ...rows, tenant_id: auth.tenantId };
        return raw.from(table).insert(withTenant);
      },
    };
  }

  return {
    from,
    /** Escape hatch — returns the unwrapped service client for cross-tenant operations. */
    raw(): RawClient {
      return raw;
    },
  };
}
