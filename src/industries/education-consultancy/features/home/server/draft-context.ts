import type { AuthContext } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { addDaysStr, localDate } from "../lib/time";
import type { DraftChannel } from "../lib/draft";
import { leadNotes } from "./lead-notes";
import { loadApplications } from "./load-home";

const CLIP = 300;
const clip = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, CLIP);

export interface DraftContext {
  lead: { firstName: string; fullName: string; phone: string | null; email: string | null; destinations: string[]; intakeTerm: string | null; fieldOfStudy: string | null };
  applications: Array<{ university: string; program: string; deadline: string | null; daysLeft: number | null; stageName: string; missing: string[]; docsAssessable: boolean }>;
  notes: Array<{ text: string; at: string }>;
  messages: Array<{ direction: "inbound" | "outbound"; text: string; at: string; channel: string }>;
  lastReplyChannel: DraftChannel | "sms" | null;
  gmail: { accountId: string; email: string } | null;
  /** EXACTLY what Orca read, for "Why this message". Nothing else is loaded. */
  recordsRead: string[];
}

const providerChannel = (p: string | null): DraftChannel | "sms" | null => (p === "whatsapp" ? "whatsapp" : p === "email" || p === "gmail" ? "email" : p === "sms" ? "sms" : null);

/**
 * What Orca may read for one draft: the lead's record, its applications and document checklist, the last 3 notes and the last 3
 * messages. Nothing else. The caller has ALREADY proved the person can see this lead (loadVisibleLead). Phone and email are returned
 * for the panel's buttons and are never put in a prompt (draft prompts take only `lead.firstName`, destinations, intake, course).
 */
export async function loadDraftContext(auth: AuthContext, leadId: string, tz: string, now: Date): Promise<DraftContext | null> {
  const db = await scopedClient(auth);
  const today = localDate(now, tz);
  const { data: leadRow } = await db.from("leads").select("first_name, last_name, phone, email, destinations, intake_term, field_of_study").eq("id", leadId).is("deleted_at", null).maybeSingle();
  const l = leadRow as unknown as { first_name: string | null; last_name: string | null; phone: string | null; email: string | null; destinations: string[] | null; intake_term: string | null; field_of_study: string | null } | null;
  if (!l) return null;
  const fullName = [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || "this lead";

  const [apps, notesRes, convRes, acctRes] = await Promise.all([
    loadApplications(db, { leadId }, today).catch(() => ({ applications: [], submitStageByPipeline: new Map() })),
    leadNotes(db, auth.tenantId, "content, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(3),
    db.from("conversations").select("id, provider").eq("lead_id", leadId),
    db.from("connected_email_accounts").select("id, email").eq("user_id", auth.userId).limit(1),
  ]);

  const convs = ((convRes.data ?? []) as unknown as Array<{ id: string; provider: string | null }>);
  const providerOf = new Map(convs.map((c) => [c.id, c.provider]));
  let messages: DraftContext["messages"] = [];
  if (convs.length > 0) {
    const { data } = await db.from("messages").select("direction, content_text, created_at, conversation_id").in("conversation_id", convs.map((c) => c.id)).neq("status", "draft").order("created_at", { ascending: false }).limit(3);
    messages = ((data ?? []) as unknown as Array<{ direction: "inbound" | "outbound"; content_text: string | null; created_at: string; conversation_id: string }>)
      .filter((m) => m.content_text)
      .map((m) => ({ direction: m.direction, text: clip(m.content_text), at: m.created_at, channel: providerOf.get(m.conversation_id) ?? "message" }));
  }
  const lastInbound = messages.find((m) => m.direction === "inbound");
  const acct = ((acctRes.data ?? []) as unknown as Array<{ id: string; email: string }>)[0] ?? null;

  const applications = apps.applications.map((a) => ({
    university: a.university,
    program: a.program,
    deadline: a.deadline,
    daysLeft: a.deadline ? Math.round((Date.parse(`${a.deadline}T00:00:00Z`) - Date.parse(`${addDaysStr(today, 0)}T00:00:00Z`)) / 86_400_000) : null,
    stageName: a.stageName,
    missing: a.docs.missingLabels,
    docsAssessable: a.docs.assessable,
  }));
  const notes = ((notesRes.data ?? []) as unknown as Array<{ content: string; created_at: string }>).map((n) => ({ text: clip(n.content), at: n.created_at }));

  const first = l.first_name?.trim() || fullName;
  const recordsRead = [
    `${first}'s record`,
    ...(applications.length ? [`${first}'s application${applications.length > 1 ? "s" : ""} and document checklist`] : []),
    ...(notes.length ? [`your last ${notes.length} note${notes.length > 1 ? "s" : ""}`] : []),
    ...(messages.length ? [`your last ${messages.length} message${messages.length > 1 ? "s" : ""} with ${first}`] : []),
  ];
  return {
    lead: { firstName: first, fullName, phone: l.phone, email: l.email, destinations: l.destinations ?? [], intakeTerm: l.intake_term, fieldOfStudy: l.field_of_study },
    applications,
    notes,
    messages,
    lastReplyChannel: lastInbound ? providerChannel(lastInbound.channel) : null,
    gmail: acct && l.email ? { accountId: acct.id, email: acct.email } : null,
    recordsRead,
  };
}
