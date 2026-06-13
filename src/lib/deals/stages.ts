import { scopedClient } from "@/lib/supabase/scoped";

type ScopedClient = Awaited<ReturnType<typeof scopedClient>>;

export const DEFAULT_DEAL_STAGES = [
  { name: "Qualification",  slug: "qualification",  position: 0, color: "#3b82f6", is_default: true,  is_terminal: false, terminal_type: null },
  { name: "Needs Analysis", slug: "needs-analysis", position: 1, color: "#8b5cf6", is_default: false, is_terminal: false, terminal_type: null },
  { name: "Proposal",       slug: "proposal",       position: 2, color: "#f59e0b", is_default: false, is_terminal: false, terminal_type: null },
  { name: "Negotiation",    slug: "negotiation",    position: 3, color: "#f97316", is_default: false, is_terminal: false, terminal_type: null },
  { name: "Closed Won",     slug: "closed-won",     position: 4, color: "#22c55e", is_default: false, is_terminal: true,  terminal_type: "won" as const },
  { name: "Closed Lost",    slug: "closed-lost",    position: 5, color: "#ef4444", is_default: false, is_terminal: true,  terminal_type: "lost" as const },
] as const;

/**
 * Ensures a tenant has deal stages. If none exist, inserts the 6 defaults.
 * Idempotent — safe to call on every board/list load.
 */
export async function ensureDealStages(db: ScopedClient, tenantId: string): Promise<void> {
  const { count } = await db
    .from("deal_stages")
    .select("*", { count: "exact", head: true });

  if ((count ?? 0) > 0) return;

  await db.from("deal_stages").insert(
    DEFAULT_DEAL_STAGES.map((s) => ({ ...s, tenant_id: tenantId }))
  );
}
