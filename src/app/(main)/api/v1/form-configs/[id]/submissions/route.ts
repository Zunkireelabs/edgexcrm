import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiNotFound, apiError, apiPaginated } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";

type RouteParams = { params: Promise<{ id: string }> };

const SELECT_COLUMNS =
  "id, created_at, first_name, last_name, email, phone, city, country, matched_existing, " +
  "created_via, intake_source, intake_medium, intake_campaign, custom_fields, file_urls, " +
  "raw_payload, lead_id";

interface SubmissionRow {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  matched_existing: boolean;
  created_via: string;
  intake_source: string | null;
  intake_medium: string | null;
  intake_campaign: string | null;
  custom_fields: Record<string, unknown>;
  file_urls: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  lead_id: string;
}

interface LeadRef {
  id: string;
  display_id: string | null;
  deleted_at: string | null;
  merged_into: string | null;
}

// long id lists have blown the undici header limit here before —
// see project_counselor_empty_leads_undici_overflow
const LEAD_CHUNK_SIZE = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchLeadRefs(
  db: Awaited<ReturnType<typeof scopedClient>>,
  leadIds: string[]
): Promise<Map<string, LeadRef>> {
  const map = new Map<string, LeadRef>();
  const uniqueIds = Array.from(new Set(leadIds));
  for (const batch of chunk(uniqueIds, LEAD_CHUNK_SIZE)) {
    const { data } = await db
      .from("leads")
      .select("id, display_id, deleted_at, merged_into")
      .in("id", batch);
    for (const row of (data ?? []) as unknown as LeadRef[]) {
      map.set(row.id, row);
    }
  }
  return map;
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: SubmissionRow[], leadRefs: Map<string, LeadRef>): string {
  const header = [
    "Date",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "City",
    "Country",
    "Status",
    "Source",
    "Medium",
    "Campaign",
    "Lead Status",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const lead = leadRefs.get(r.lead_id);
    const leadStatus = lead?.deleted_at ? "Deleted" : lead?.merged_into ? "Merged" : "";
    lines.push(
      [
        r.created_at,
        r.first_name,
        r.last_name,
        r.email,
        r.phone,
        r.city,
        r.country,
        r.matched_existing ? "Existing lead" : "New lead",
        r.intake_source,
        r.intake_medium,
        r.intake_campaign,
        leadStatus,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/form-configs/${id}/submissions`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.FORM_BUILDER)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: form } = await db.from("form_configs").select("id").eq("id", id).maybeSingle();
  if (!form) return apiNotFound("Form config");

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const matched = url.searchParams.get("matched");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");

  function buildQuery(pageFrom: number, pageTo: number, withCount: boolean) {
    let query = db
      .from("lead_submissions")
      .select(SELECT_COLUMNS, withCount ? { count: "exact" } : undefined)
      .eq("form_config_id", id);

    if (q) {
      // Strip characters that have special meaning in PostgREST .or() parsing
      // (commas separate OR conditions; parens group; backslash escapes) — same
      // convention as src/app/(main)/api/v1/contacts/route.ts.
      const safeQ = q.replace(/[,()\\]/g, " ").trim();
      if (safeQ) {
        query = query.or(
          `first_name.ilike.%${safeQ}%,last_name.ilike.%${safeQ}%,email.ilike.%${safeQ}%,phone.ilike.%${safeQ}%`
        );
      }
    }
    if (matched === "new") query = query.eq("matched_existing", false);
    else if (matched === "existing") query = query.eq("matched_existing", true);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(pageFrom, pageTo);
  }

  if (format === "csv") {
    const CSV_PAGE_SIZE = 1000;
    const all: SubmissionRow[] = [];
    let pageFrom = 0;
    for (;;) {
      const { data, error } = await buildQuery(pageFrom, pageFrom + CSV_PAGE_SIZE - 1, false);
      if (error) {
        log.error({ error }, "Failed to export submissions CSV");
        return apiError("DB_ERROR", "Failed to export submissions", 500);
      }
      const rows = (data ?? []) as unknown as SubmissionRow[];
      all.push(...rows);
      if (rows.length < CSV_PAGE_SIZE) break;
      pageFrom += CSV_PAGE_SIZE;
    }
    const leadRefs = await fetchLeadRefs(db, all.map((r) => r.lead_id));
    const csv = toCsv(all, leadRefs);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="form-${id}-submissions.csv"`,
      },
    });
  }

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const pageFrom = (page - 1) * limit;
  const pageTo = pageFrom + limit - 1;

  const { data, error, count } = await buildQuery(pageFrom, pageTo, true);
  if (error) {
    log.error({ error }, "Failed to fetch submissions");
    return apiError("DB_ERROR", "Failed to fetch submissions", 500);
  }

  const rows = (data ?? []) as unknown as SubmissionRow[];
  const leadRefs = await fetchLeadRefs(db, rows.map((r) => r.lead_id));

  const enriched = rows.map((r) => {
    const lead = leadRefs.get(r.lead_id);
    return {
      ...r,
      lead: lead
        ? { display_id: lead.display_id, isDeleted: Boolean(lead.deleted_at), isMerged: Boolean(lead.merged_into) }
        : null,
    };
  });

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return apiPaginated(enriched, { page, pageSize: limit, total, totalPages });
}
