import type { AuthContext } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { relativeAge } from "../lib/draft";
import { kbQuery, type KnownInput } from "../lib/call-prep";

export interface CallPrepLead extends KnownInput {
  firstName: string;
  fullName: string;
  phone: string | null;
  source: string | null;
  createdAt: string | null;
  record: Record<string, string>;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The lead's record for the prep panel. The caller has ALREADY proved the person can see this lead (loadVisibleLead). The phone is
 * returned only so the route can MASK it; it is never put in a prompt or sent to the browser whole.
 */
export async function loadCallPrepLead(auth: AuthContext, leadId: string): Promise<CallPrepLead | null> {
  const db = await scopedClient(auth);
  const { data } = await db
    .from("leads")
    .select("first_name, last_name, phone, custom_fields, destinations, intake_term, field_of_study, ielts_score, sponsor_name, sponsor_relationship, plus_two_gpa, bachelor_gpa, masters_gpa, plus_two_stream_faculty, intake_source, intake_campaign, created_at")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  const l = data as unknown as Record<string, unknown> | null;
  if (!l) return null;
  const cf = (l.custom_fields ?? {}) as Record<string, unknown>;
  const first = s(l.first_name);
  const fullName = [first, s(l.last_name)].filter(Boolean).join(" ") || "this lead";
  const source = [s(l.intake_source).replace(/_/g, " "), s(l.intake_campaign)].filter(Boolean).join(": ") || null;
  return {
    firstName: first || fullName,
    fullName,
    phone: s(l.phone) || null,
    source,
    createdAt: typeof l.created_at === "string" ? l.created_at : null,
    destinations: Array.isArray(l.destinations) ? (l.destinations as string[]) : [],
    intakeTerm: s(l.intake_term) || null,
    fieldOfStudy: s(l.field_of_study) || null,
    plusTwoStream: s(l.plus_two_stream_faculty) || null,
    plusTwoGpa: s(l.plus_two_gpa) || null,
    bachelorGpa: s(l.bachelor_gpa) || null,
    mastersGpa: s(l.masters_gpa) || null,
    ieltsScore: s(l.ielts_score) || null,
    customFields: cf,
    record: {
      ielts_score: s(l.ielts_score),
      english_test_plan: s(cf.english_test_plan),
      sponsor_name: s(l.sponsor_name),
      sponsor_relationship: s(l.sponsor_relationship),
      budget: s(cf.budget),
      destinations: Array.isArray(l.destinations) ? (l.destinations as string[]).join(", ") : "",
      intake_term: s(l.intake_term),
      field_of_study: s(l.field_of_study),
      plus_two_gpa: s(l.plus_two_gpa),
      bachelor_gpa: s(l.bachelor_gpa),
      masters_gpa: s(l.masters_gpa),
    },
  };
}

/** The facts for the opening line: the lead's own words and record, no contact details. Timing only as a relative age that IS a fact. */
export function openingFacts(l: CallPrepLead, now: Date, tz: string): string[] {
  const f: string[] = [];
  if (l.fieldOfStudy) f.push(`Field of study the lead asked about: ${l.fieldOfStudy}`);
  if (l.destinations.length) f.push(`Country the lead asked about: ${l.destinations.join(", ")}`);
  if (l.intakeTerm) f.push(`Intake: ${l.intakeTerm}`);
  if (l.source) f.push(`How the lead came to us: ${l.source}`);
  if (l.createdAt) f.push(`The enquiry arrived ${relativeAge(l.createdAt, now, tz)}`);
  for (const [k, v] of Object.entries(l.customFields ?? {})) {
    if (typeof v === "string" && v.trim() && v.length <= 120 && !/phone|mobile|email|passport|document|file|url|link|token/i.test(k)) f.push(`Form answer, ${k.replace(/[_-]+/g, " ")}: ${v.trim()}`);
    if (f.length >= 14) break;
  }
  return f;
}

export { kbQuery };
