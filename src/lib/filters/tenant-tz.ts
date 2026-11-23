/**
 * The timezone a tenant's date filters count days in (EDGEX-114). `CompileCtx.tz` decides where "on 9 Oct" / "between 9 Oct and 7 Nov" begin
 * and end; a literal "UTC" there made a lead that arrived at 00:17 Nepal time count as the previous day. Every caller that builds a
 * CompileCtx for a real tenant takes the tz from here, from `tenants.timezone`. (Pure; lives beside the compiler but imports nothing.)
 */
export const DEFAULT_TENANT_TZ = "Asia/Kathmandu";

export function resolveTenantTz(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_TENANT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TENANT_TZ;
  }
}
