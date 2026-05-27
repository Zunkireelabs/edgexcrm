import type { Project, TenantUser } from "@/types/database";

export function resolveEffectiveRate(
  project: Pick<Project, "default_rate"> | null,
  member: Pick<TenantUser, "default_hourly_rate">,
): number {
  return project?.default_rate ?? member.default_hourly_rate ?? 0;
}
