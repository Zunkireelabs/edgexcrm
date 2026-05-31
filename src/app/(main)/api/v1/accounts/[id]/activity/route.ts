import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

interface ActivityItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

async function lookupEmail(db: Awaited<ReturnType<typeof scopedClient>>, userId: string): Promise<string | null> {
  try {
    const { data } = await db.raw().auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch { return null; }
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 30));

  const db = await scopedClient(auth);

  // Verify account exists
  const { data: accountRow } = await db.from("accounts").select("id").eq("id", id).maybeSingle();
  if (!accountRow) return apiNotFound("Account");

  // Step 1: fetch entity ID sets in parallel
  const [projectRes, contactRes, leadRes] = await Promise.all([
    db.from("projects").select("id, name").eq("account_id", id),
    (() => {
      let q = db.from("contacts").select("id, first_name, last_name").eq("account_id", id).is("deleted_at", null);
      if (auth.role === "counselor") q = q.eq("assigned_to", auth.userId);
      return q;
    })(),
    (() => {
      let q = db.from("leads").select("id, first_name, last_name, email").eq("account_id", id).is("deleted_at", null);
      if (auth.role === "counselor") q = q.eq("assigned_to", auth.userId);
      return q;
    })(),
  ]);

  if (projectRes.error || contactRes.error || leadRes.error) {
    return apiError("DB_ERROR", "Failed to fetch account entities", 500);
  }

  const projectRows = (projectRes.data ?? []) as unknown as { id: string; name: string }[];
  const contactRows = (contactRes.data ?? []) as unknown as { id: string; first_name: string; last_name: string }[];
  const leadRows = (leadRes.data ?? []) as unknown as { id: string; first_name: string | null; last_name: string | null; email: string | null }[];

  const projectIds = projectRows.map((p) => p.id);
  const contactIds = contactRows.map((c) => c.id);
  const leadIds = leadRows.map((l) => l.id);

  const projectNameMap = new Map(projectRows.map((p) => [p.id, p.name]));
  const contactNameMap = new Map(contactRows.map((c) => [c.id, `${c.first_name} ${c.last_name}`.trim() || "Unknown"]));
  const leadNameMap = new Map(leadRows.map((l) => [l.id, [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || "Unknown"]));

  // All entity IDs relevant to this account
  const allEntityIds = [id, ...projectIds, ...contactIds, ...leadIds];

  // Step 2: fetch events + time_entry events (approve/reject) + time_entries in parallel
  const timeEntriesQuery = (() => {
    if (projectIds.length === 0) return Promise.resolve({ data: [], error: null });
    let q = db
      .from("time_entries")
      .select("user_id, entry_date, project_id, minutes, created_at")
      .in("project_id", projectIds);
    if (auth.role === "counselor") q = q.eq("user_id", auth.userId);
    return q.limit(500);
  })();

  const timeEntryEventsQuery = (() => {
    let tq = db
      .from("events")
      .select("id, type, entity_type, entity_id, payload, created_at")
      .eq("entity_type", "time_entry")
      .neq("type", "time_entry.created")
      .contains("payload", { account_id: id })
      .order("created_at", { ascending: false })
      .limit(50);
    if (auth.role === "counselor") tq = tq.filter("payload->>user_id", "eq", auth.userId);
    return tq;
  })();

  const [eventsRes, timeRes, teEventsRes] = await Promise.all([
    db
      .from("events")
      .select("id, type, entity_type, entity_id, payload, created_at")
      .in("entity_id", allEntityIds)
      .neq("type", "time_entry.created")
      .order("created_at", { ascending: false })
      .limit(100),
    timeEntriesQuery,
    timeEntryEventsQuery,
  ]);

  if (eventsRes.error || timeRes.error || teEventsRes.error) {
    return apiError("DB_ERROR", "Failed to fetch activity data", 500);
  }

  // Merge account/project/contact/lead events with time_entry approve/reject events
  type RawEvent = { id: string; type: string; entity_type: string; entity_id: string; payload: Record<string, unknown>; created_at: string };
  const allEventRows = [
    ...((eventsRes.data ?? []) as unknown as RawEvent[]),
    ...((teEventsRes.data ?? []) as unknown as RawEvent[]),
  ];

  // Enrich events with known names from local maps
  const eventItems: ActivityItem[] = allEventRows.map((event) => {
    const enriched = { ...event.payload };
    if (event.entity_type === "project") {
      enriched.project_name = projectNameMap.get(event.entity_id) ?? enriched.project_name ?? null;
    }
    if (event.entity_type === "contact") {
      enriched.contact_name = contactNameMap.get(event.entity_id) ?? null;
    }
    if (event.entity_type === "lead") {
      enriched.lead_name = leadNameMap.get(event.entity_id) ?? null;
    }
    // project.updated / time_entry events carry project_id in payload
    const pidFromPayload = enriched.project_id as string | undefined;
    if (pidFromPayload && !enriched.project_name) {
      enriched.project_name = projectNameMap.get(pidFromPayload) ?? null;
    }
    return { id: event.id, type: event.type, payload: enriched, created_at: event.created_at };
  });

  // Aggregate time entries into derived time-logged items
  type GroupKey = string;
  interface TimeGroup {
    user_id: string;
    entry_date: string;
    project_id: string;
    project_name: string;
    minutes_sum: number;
    created_at: string;
  }
  const groups = new Map<GroupKey, TimeGroup>();
  for (const entry of (timeRes.data ?? []) as { user_id: string; entry_date: string; project_id: string; minutes: number; created_at: string }[]) {
    const key = `${entry.user_id}:${entry.entry_date}:${entry.project_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.minutes_sum += entry.minutes;
      if (entry.created_at > existing.created_at) existing.created_at = entry.created_at;
    } else {
      groups.set(key, {
        user_id: entry.user_id,
        entry_date: entry.entry_date,
        project_id: entry.project_id,
        project_name: projectNameMap.get(entry.project_id) ?? "Unknown Project",
        minutes_sum: entry.minutes,
        created_at: entry.created_at,
      });
    }
  }

  const derivedItems: ActivityItem[] = Array.from(groups.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100)
    .map((g) => ({
      id: `te-${g.entry_date}-${g.user_id.slice(0, 8)}-${g.project_id.slice(0, 8)}`,
      type: "time_entry.logged",
      payload: { user_id: g.user_id, project_id: g.project_id, project_name: g.project_name, minutes_sum: g.minutes_sum },
      created_at: g.created_at,
    }));

  // Step 3: merge + paginate
  const merged = [...eventItems, ...derivedItems].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const start = (page - 1) * limit;
  const pageItems = merged.slice(start, start + limit);
  const nextPage = merged.length > start + limit ? page + 1 : null;

  // Step 4: enrich with user emails for items that carry a user_id in payload
  const userIds = [...new Set(
    pageItems.flatMap((item) => {
      const uid = item.payload.user_id;
      return typeof uid === "string" ? [uid] : [];
    })
  )];

  const emailMap = new Map<string, string | null>();
  await Promise.all(userIds.map(async (uid) => {
    emailMap.set(uid, await lookupEmail(db, uid));
  }));

  const enriched = pageItems.map((item) => {
    const uid = item.payload.user_id;
    if (typeof uid === "string") {
      return { ...item, payload: { ...item.payload, user_email: emailMap.get(uid) ?? null } };
    }
    return item;
  });

  return apiSuccess({ items: enriched, next_page: nextPage });
}
