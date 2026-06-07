import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import type { Lead } from "@/types/database";

interface DuplicateSuggestionRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  suggested_lead_id: string;
  reason: string;
  status: string;
  created_at: string;
}

interface EnrichedSuggestion {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  other_lead: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
  };
}

// GET /api/v1/leads/:id/duplicates
// Returns open duplicate suggestions touching this lead in either direction,
// each enriched with the other lead's key fields for display.
// Admin-gated — the card is hidden from counselors/viewers.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: `/api/v1/leads/${id}/duplicates` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const isAdmin = auth.role === "owner" || auth.role === "admin";
  if (!isAdmin) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify the lead belongs to this tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!lead) return apiNotFound("Lead");

  // Fetch suggestions in both directions
  const { data: suggestions, error } = await supabase
    .from("lead_duplicate_suggestions")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("status", "open")
    .or(`lead_id.eq.${id},suggested_lead_id.eq.${id}`);

  if (error) {
    log.error({ err: error }, "Failed to fetch duplicate suggestions");
    return apiServiceUnavailable("Failed to fetch duplicate suggestions");
  }

  if (!suggestions || suggestions.length === 0) {
    return apiSuccess([], 200);
  }

  // Collect the IDs of the other leads for enrichment
  const rows = suggestions as DuplicateSuggestionRow[];
  const otherLeadIds = rows.map((s) => (s.lead_id === id ? s.suggested_lead_id : s.lead_id));
  const uniqueOtherIds = [...new Set(otherLeadIds)];

  const { data: otherLeads } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, phone, created_at")
    .in("id", uniqueOtherIds)
    .eq("tenant_id", auth.tenantId);

  const otherLeadMap = new Map(
    ((otherLeads ?? []) as Pick<Lead, "id" | "first_name" | "last_name" | "email" | "phone" | "created_at">[]).map((l) => [l.id, l])
  );

  const enriched: EnrichedSuggestion[] = rows
    .map((s) => {
      const otherId = s.lead_id === id ? s.suggested_lead_id : s.lead_id;
      const other = otherLeadMap.get(otherId);
      if (!other) return null;
      return {
        id: s.id,
        reason: s.reason,
        status: s.status,
        created_at: s.created_at,
        other_lead: {
          id: other.id,
          first_name: other.first_name,
          last_name: other.last_name,
          email: other.email,
          phone: other.phone,
          created_at: other.created_at,
        },
      };
    })
    .filter((s): s is EnrichedSuggestion => s !== null);

  log.info({ count: enriched.length }, "Duplicate suggestions fetched");
  return apiSuccess(enriched, 200);
}
