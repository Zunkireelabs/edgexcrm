/**
 * Tenant-scoped Supabase client wrapper.
 *
 * Eliminates the "forgot to add `.eq('tenant_id', auth.tenantId)`"
 * trap that exists across many authenticated routes. Wraps the
 * service-role client and auto-applies tenant filters on every query
 * for tenant-owned tables.
 *
 * ## Usage
 *
 *   const auth = await authenticateRequest();
 *   if (!auth) return apiUnauthorized();
 *   const db = await scopedClient(auth);
 *
 *   const { data } = await db.from("leads").select("*");
 *   //                       ^ tenant filter auto-applied
 *
 *   const { data: created } = await db
 *     .from("leads")
 *     .insert({ first_name: "Ada", email: "a@b.com" });
 *   //   ^ tenant_id auto-injected; caller-supplied tenant_id is
 *   //     stripped to prevent cross-tenant insert via request param
 *
 *   const { count } = await db
 *     .from("notifications")
 *     .select("*", { count: "exact", head: true })
 *     .eq("user_id", auth.userId);
 *   //   ^ count/head options forwarded; tenant filter still applied
 *
 *   const { data: users } = await db.fromGlobal("auth.users").select("*");
 *   //                              ^ for tables WITHOUT tenant_id
 *
 *   await db.raw().auth.admin.listUsers();
 *   //  ^ escape hatch for service-level operations (auth.admin etc.)
 *
 *   await db
 *     .from("intake_years")
 *     .upsert({ name: "2036" }, { onConflict: "tenant_id,name", ignoreDuplicates: true });
 *   //   ^ tenant_id auto-injected/stripped same as insert(); ON CONFLICT-aware
 *   //     for idempotent "make sure this row exists" writes
 *
 * ## Discipline constraints (not enforced by the wrapper)
 *
 * - `.update()` and `.delete()` chain `.eq("tenant_id", auth.tenantId)`
 *   only. The caller MUST chain at least one additional filter (e.g.
 *   `.eq("id", leadId)`) before awaiting — otherwise the operation
 *   targets every row in the tenant. The wrapper cannot prevent this
 *   at compile time; PR review is the only guard.
 *
 * - `tenant_id` is stripped from `update()`, `insert()`, and `upsert()`
 *   payloads before forwarding. A caller cannot move a row to a different
 *   tenant via the wrapper.
 *
 * - `.upsert()`'s caller-supplied `onConflict` MUST include `tenant_id`
 *   as one of the conflict columns (e.g. `"tenant_id,name"`, never just
 *   `"name"`). `tenant_id` is stripped from the payload and re-injected
 *   as the CURRENT caller's tenant — so if the conflict target omits it,
 *   `ON CONFLICT DO UPDATE`-style upserts could match and silently
 *   reassign another tenant's existing row to the caller's tenant. The
 *   wrapper cannot enforce this at compile time; PR review is the only
 *   guard, same as the `.update()`/`.delete()` filter requirement above.
 *
 * - For cross-tenant operations (admin backfills, support tooling),
 *   use `db.raw()` — the naming makes the escape hatch obvious in
 *   review.
 *
 * Migration of legacy routes that use `createServiceClient()` + manual
 * `.eq("tenant_id", ...)` to this wrapper is tracked on STATUS-BOARD
 * as ongoing hardening work.
 */

import { createServiceClient } from "./server";
import type { AuthContext } from "@/lib/api/auth";

type RawClient = Awaited<ReturnType<typeof createServiceClient>>;

interface SelectOptions {
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
}

function stripTenantId<T extends Record<string, unknown>>(row: T): Omit<T, "tenant_id"> {
  const { tenant_id: _stripped, ...safe } = row as T & { tenant_id?: unknown };
  return safe;
}

export async function scopedClient(auth: AuthContext) {
  const raw = await createServiceClient();

  function from(table: string) {
    return {
      // NOTE: row-type inference from the columns literal is lost here
      // (Supabase's typed select() uses complex conditional types that
      // make a generic passthrough explode compile memory). Callers
      // that need typed row data should cast at the call site, e.g.:
      //   const { data } = await db.from("x").select("a, b");
      //   const rows = (data ?? []) as Array<{ a: string; b: number }>;
      select(columns: string = "*", options?: SelectOptions) {
        const base = raw.from(table);
        const q = options ? base.select(columns, options) : base.select(columns);
        return q.eq("tenant_id", auth.tenantId);
      },
      update(values: Record<string, unknown>) {
        // Strip caller-supplied tenant_id so a malicious or buggy
        // caller cannot SET tenant_id to another tenant.
        const safe = stripTenantId(values);
        return raw.from(table).update(safe).eq("tenant_id", auth.tenantId);
      },
      delete() {
        return raw.from(table).delete().eq("tenant_id", auth.tenantId);
      },
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        const withTenant = Array.isArray(rows)
          ? rows.map((r) => ({ ...stripTenantId(r), tenant_id: auth.tenantId }))
          : { ...stripTenantId(rows), tenant_id: auth.tenantId };
        return raw.from(table).insert(withTenant);
      },
      // Same tenant_id injection/stripping as insert(), but ON CONFLICT-aware —
      // for idempotent "make sure these rows exist" writes (e.g. a lookup
      // table topping itself up) where a plain insert() would abort the whole
      // batch the moment any one row collides with an existing unique key.
      upsert(
        rows: Record<string, unknown> | Record<string, unknown>[],
        options: { onConflict: string; ignoreDuplicates?: boolean }
      ) {
        const withTenant = Array.isArray(rows)
          ? rows.map((r) => ({ ...stripTenantId(r), tenant_id: auth.tenantId }))
          : { ...stripTenantId(rows), tenant_id: auth.tenantId };
        return raw.from(table).upsert(withTenant, options);
      },
    };
  }

  /**
   * For tables that do NOT have a `tenant_id` column (auth.users,
   * shared lookups, system tables). No tenant filter is applied —
   * security on these tables comes from RLS or the table being
   * read-only system data.
   */
  function fromGlobal(table: string) {
    return raw.from(table);
  }

  return {
    from,
    fromGlobal,
    /** Escape hatch — returns the unwrapped service client for cross-tenant operations (admin backfills, support tooling, auth.admin). */
    raw(): RawClient {
      return raw;
    },
  };
}
