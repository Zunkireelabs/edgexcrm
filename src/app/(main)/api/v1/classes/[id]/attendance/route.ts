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
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canMarkClassAttendance } from "@/lib/api/class-attendance";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

interface EnrollmentRow {
  id: string;
  lead_id: string;
  leads: { id: string; first_name: string; last_name: string | null } | { id: string; first_name: string; last_name: string | null }[] | null;
}

function leadName(embed: EnrollmentRow["leads"]): { first_name: string; last_name: string | null } | null {
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!(await canMarkClassAttendance(auth))) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date)) {
    return apiValidationError({ date: ["date is required in YYYY-MM-DD format"] });
  }

  const db = await scopedClient(auth);

  const { data: classRow } = await db.from("classes").select("id, name").eq("id", id).maybeSingle();
  if (!classRow) return apiNotFound("Class");

  // All active enrollments for this class — deliberately NOT filtered to the
  // caller's assigned leads; markers see every student enrolled in the class.
  const { data: enrollments, error: enrollError } = await db
    .from("class_enrollments")
    .select("id, lead_id, leads!class_enrollments_lead_id_fkey(id,first_name,last_name)")
    .eq("class_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (enrollError) return apiError("DB_ERROR", "Failed to fetch enrollments", 500);

  const enrollmentRows = (enrollments ?? []) as unknown as EnrollmentRow[];
  const enrollmentIds = enrollmentRows.map((e) => e.id);

  const attendanceByEnrollment = new Map<string, string>();
  if (enrollmentIds.length > 0) {
    const { data: attendance, error: attError } = await db
      .from("class_attendance")
      .select("enrollment_id, status")
      .eq("session_date", date)
      .in("enrollment_id", enrollmentIds);

    if (attError) return apiError("DB_ERROR", "Failed to fetch attendance", 500);

    for (const row of (attendance ?? []) as unknown as { enrollment_id: string; status: string }[]) {
      attendanceByEnrollment.set(row.enrollment_id, row.status);
    }
  }

  const students = enrollmentRows.map((e) => {
    const lead = leadName(e.leads);
    return {
      enrollment_id: e.id,
      lead_id: e.lead_id,
      name: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : "Unknown",
      status: attendanceByEnrollment.get(e.id) ?? null,
    };
  });

  return apiSuccess({ class: classRow, date, students });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/classes/${id}/attendance` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!(await canMarkClassAttendance(auth))) return apiForbidden();

  let body: { date?: unknown; records?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!DATE_RE.test(date)) {
    return apiValidationError({ date: ["date is required in YYYY-MM-DD format"] });
  }

  if (!Array.isArray(body.records) || body.records.length === 0) {
    return apiValidationError({ records: ["records must be a non-empty array"] });
  }

  const records = body.records as Array<{ enrollment_id?: unknown; status?: unknown }>;
  for (const r of records) {
    if (typeof r.enrollment_id !== "string" || !r.enrollment_id) {
      return apiValidationError({ records: ["each record needs an enrollment_id"] });
    }
    if (r.status !== "present" && r.status !== "absent") {
      return apiValidationError({ records: ["each record's status must be present or absent"] });
    }
  }

  const db = await scopedClient(auth);

  const { data: classRow } = await db.from("classes").select("id").eq("id", id).maybeSingle();
  if (!classRow) return apiNotFound("Class");

  // Every enrollment_id must belong to THIS class and tenant (scopedClient's
  // tenant filter covers tenant; the class_id check below prevents marking
  // attendance for a student enrolled in a different class via a forged id).
  const { data: validEnrollments, error: enrollError } = await db
    .from("class_enrollments")
    .select("id")
    .eq("class_id", id)
    .is("deleted_at", null);

  if (enrollError) return apiError("DB_ERROR", "Failed to verify enrollments", 500);

  const validIds = new Set(((validEnrollments ?? []) as unknown as { id: string }[]).map((e) => e.id));
  for (const r of records) {
    if (!validIds.has(r.enrollment_id as string)) {
      return apiValidationError({ records: [`enrollment_id ${r.enrollment_id} is not an active enrollment in this class`] });
    }
  }

  const rows = records.map((r) => ({
    enrollment_id: r.enrollment_id as string,
    session_date: date,
    status: r.status as string,
    marked_by: auth.userId,
  }));

  // onConflict matches class_attendance's actual unique constraint
  // (enrollment_id, session_date) — no tenant_id column in that constraint.
  // Safe because every enrollment_id above was just verified to belong to this
  // tenant's class via the scoped validEnrollments lookup.
  const { error: upsertError } = await db
    .from("class_attendance")
    .upsert(rows, { onConflict: "enrollment_id,session_date" });

  if (upsertError) {
    log.error({ error: upsertError }, "Failed to save attendance");
    return apiError("DB_ERROR", "Failed to save attendance", 500);
  }

  log.info({ classId: id, date, count: rows.length }, "Attendance saved");
  return apiSuccess({ date, count: rows.length });
}
