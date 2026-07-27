import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

interface LeadContact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface EnrollmentRow {
  id: string;
  lead_id: string;
  leads: LeadContact | LeadContact[] | null;
}

function leadContact(embed: EnrollmentRow["leads"]): LeadContact | null {
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  // NOTE: intentionally NO canMarkClassAttendance gate — any Classes user may view history.

  const { searchParams } = new URL(request.url);
  const today = new Date();
  const to = searchParams.get("to") ?? isoDate(today);
  const from = searchParams.get("from") ?? isoDate(new Date(today.getTime() - 30 * 86400000));
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return apiValidationError({ range: ["from/to must be YYYY-MM-DD"] });
  }
  if (from > to) {
    return apiValidationError({ range: ["from must be on or before to"] });
  }

  const db = await scopedClient(auth);

  const { data: classRow } = await db.from("classes").select("id, name").eq("id", id).maybeSingle();
  if (!classRow) return apiNotFound("Class");

  // All active enrollments for this class — NOT filtered to caller's assigned leads.
  const { data: enrollments, error: enrollError } = await db
    .from("class_enrollments")
    .select("id, lead_id, leads!class_enrollments_lead_id_fkey(id,first_name,last_name,email,phone)")
    .eq("class_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (enrollError) return apiError("DB_ERROR", "Failed to fetch enrollments", 500);

  const enrollmentRows = (enrollments ?? []) as unknown as EnrollmentRow[];
  const enrollmentIds = enrollmentRows.map((e) => e.id);

  // enrollment_id -> (date -> status)
  const byEnrollment = new Map<string, Record<string, "present" | "absent">>();
  const dateSet = new Set<string>();

  if (enrollmentIds.length > 0) {
    const { data: attendance, error: attError } = await db
      .from("class_attendance")
      .select("enrollment_id, session_date, status")
      .in("enrollment_id", enrollmentIds)
      .gte("session_date", from)
      .lte("session_date", to);
    if (attError) return apiError("DB_ERROR", "Failed to fetch attendance", 500);

    for (const row of (attendance ?? []) as unknown as {
      enrollment_id: string;
      session_date: string;
      status: "present" | "absent";
    }[]) {
      dateSet.add(row.session_date);
      const map = byEnrollment.get(row.enrollment_id) ?? {};
      map[row.session_date] = row.status;
      byEnrollment.set(row.enrollment_id, map);
    }
  }

  const dates = Array.from(dateSet).sort();

  const students = enrollmentRows.map((e) => {
    const lead = leadContact(e.leads);
    const cells = byEnrollment.get(e.id) ?? {};
    let present = 0;
    let absent = 0;
    for (const status of Object.values(cells)) {
      if (status === "present") present += 1;
      else if (status === "absent") absent += 1;
    }
    // % is present / total batch sessions (not per-student marked count) — a student
    // who joined late or has unmarked days is scored against the whole class's session
    // count, not just the days they happen to have a record for.
    return {
      enrollment_id: e.id,
      lead_id: e.lead_id,
      name: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown" : "Unknown",
      email: lead?.email ?? null,
      phone: lead?.phone ?? null,
      cells,
      present,
      absent,
      pct: dates.length === 0 ? null : Math.round((present / dates.length) * 100),
    };
  });

  return apiSuccess({ class: classRow, from, to, dates, students });
}
