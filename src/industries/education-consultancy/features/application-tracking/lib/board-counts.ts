import type { SupabaseClient } from "@supabase/supabase-js";

const CHUNK = 250; // keeps the id list under undici's 16 KB URL limit

export function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function tally(ids: (string | null)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/**
 * Per-application document counts (applicant_documents.application_id, mig 273) and
 * per-lead open-task counts (tasks has lead_id only, no application_id) for the loaded apps.
 * One batched query per 250 ids, run in parallel — no N+1.
 */
export async function fetchBoardCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  apps: { id: string; lead_id: string }[],
): Promise<{ docsByApplication: Map<string, number>; openTasksByLead: Map<string, number> }> {
  const appIds = apps.map((a) => a.id);
  const leadIds = Array.from(new Set(apps.map((a) => a.lead_id)));

  const [docRows, taskRows] = await Promise.all([
    Promise.all(
      chunk(appIds).map(async (ids) => {
        const { data } = await supabase
          .from("applicant_documents")
          .select("application_id")
          .eq("tenant_id", tenantId)
          .in("application_id", ids)
          .is("deleted_at", null);
        return (data ?? []) as { application_id: string | null }[];
      }),
    ),
    Promise.all(
      chunk(leadIds).map(async (ids) => {
        const { data } = await supabase
          .from("tasks")
          .select("lead_id")
          .eq("tenant_id", tenantId)
          .in("lead_id", ids)
          .neq("status", "done");
        return (data ?? []) as { lead_id: string | null }[];
      }),
    ),
  ]);

  return {
    docsByApplication: tally(docRows.flat().map((r) => r.application_id)),
    openTasksByLead: tally(taskRows.flat().map((r) => r.lead_id)),
  };
}
