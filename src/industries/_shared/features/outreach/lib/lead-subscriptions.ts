import type { OutreachChannel } from "./channel";

// Shapes for the lead page's "Subscribed" tab (GET /api/v1/leads/[id]/subscriptions). Pure mapping — no server imports — so the
// route builds them and the tab reads them from one definition.

/** Most campaigns shown per channel; a lead's full send log stays in the Emails / SMS views. */
export const CAMPAIGN_LIMIT = 50;

export type EnrollmentStatus = "active" | "paused" | "completed" | "unenrolled";
export type StopReason = "replied" | "sequence_paused" | "suppressed" | null;

export interface SubscribedSequence {
  id: string;
  sequenceId: string;
  sequenceName: string;
  channel: OutreachChannel;
  status: EnrollmentStatus;
  /** True while it can still send (running or paused) — at most one per channel. */
  live: boolean;
  currentStep: number;
  /** Who works this enrollment (pause / resume / unenroll are theirs or an admin's). */
  assignedTo: string | null;
  startedAt: string;
  /** When it finished or was stopped; null while live. */
  endedAt: string | null;
  stopReason: StopReason;
}

export interface QueuedSequence {
  id: string;
  sequenceId: string;
  sequenceName: string;
  channel: OutreachChannel;
  queuedAt: string;
}

export interface CampaignReceived {
  id: string;
  channel: OutreachChannel;
  /** The campaign's name; if the campaign was deleted, the email subject / the start of the text instead. */
  name: string;
  /** The campaign itself no longer exists (only this lead's copy of the message does). */
  campaignDeleted: boolean;
  status: string;
  /** When it was sent, or when it was created if it has not gone out yet. */
  at: string;
}

export interface LeadSubscriptions {
  /** Newest first: live ones and past ones together (split them with `live`). */
  sequences: SubscribedSequence[];
  queued: QueuedSequence[];
  /** Newest first. */
  campaigns: CampaignReceived[];
}

export interface RawEnrollment {
  id: string;
  sequence_id: string;
  channel?: string | null;
  status: string;
  current_step_order: number | null;
  assigned_to?: string | null;
  started_at: string;
  completed_at: string | null;
  stopped_at?: string | null;
  stop_reason?: string | null;
  email_sequences: { name: string } | null;
}
export interface RawQueueRow {
  id: string;
  sequence_id: string;
  channel?: string | null;
  created_at: string;
  email_sequences: { name: string } | null;
}
export interface RawMessage {
  id: string;
  source_id?: string | null;
  blast_id?: string | null;
  /** Email subject (email_messages). */
  subject?: string | null;
  /** Rendered text (sms_messages). */
  body?: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
}
export interface RawBlast {
  id: string;
  name: string;
}

const channelOf = (c: string | null | undefined): OutreachChannel => (c === "sms" ? "sms" : "email");
const STATUSES: EnrollmentStatus[] = ["active", "paused", "completed", "unenrolled"];
const STOP_REASONS = ["replied", "sequence_paused", "suppressed"] as const;

export function toSequenceRows(rows: RawEnrollment[]): SubscribedSequence[] {
  return rows.map((r) => {
    const status = (STATUSES as string[]).includes(r.status) ? (r.status as EnrollmentStatus) : "unenrolled";
    const live = status === "active" || status === "paused";
    return {
      id: r.id,
      sequenceId: r.sequence_id,
      sequenceName: r.email_sequences?.name ?? "Deleted sequence",
      channel: channelOf(r.channel),
      status,
      live,
      currentStep: r.current_step_order ?? 0,
      assignedTo: r.assigned_to ?? null,
      startedAt: r.started_at,
      endedAt: live ? null : (r.completed_at ?? r.stopped_at ?? null),
      stopReason: (STOP_REASONS as readonly string[]).includes(r.stop_reason ?? "") ? (r.stop_reason as StopReason) : null,
    };
  });
}

export function toQueuedRows(rows: RawQueueRow[]): QueuedSequence[] {
  return rows.map((r) => ({
    id: r.id,
    sequenceId: r.sequence_id,
    sequenceName: r.email_sequences?.name ?? "Deleted sequence",
    channel: channelOf(r.channel),
    queuedAt: r.created_at,
  }));
}

/** Up to `max` characters of a message, on one line, with an ellipsis when cut. */
function snippet(text: string | null | undefined, max = 60): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function toCampaignRows(emails: RawMessage[], texts: RawMessage[], emailBlasts: RawBlast[], smsBlasts: RawBlast[]): CampaignReceived[] {
  const emailNames = new Map(emailBlasts.map((b) => [b.id, b.name]));
  const smsNames = new Map(smsBlasts.map((b) => [b.id, b.name]));
  const row = (m: RawMessage, channel: OutreachChannel, campaignName: string | undefined, fallback: string): CampaignReceived => ({
    id: m.id,
    channel,
    name: campaignName || fallback,
    campaignDeleted: !campaignName,
    status: m.status,
    at: m.sent_at ?? m.created_at,
  });
  const rows: CampaignReceived[] = [
    ...emails.map((m) =>
      row(m, "email", m.source_id ? emailNames.get(m.source_id) : undefined, snippet(m.subject) || "Email campaign"),
    ),
    ...texts.map((m) => row(m, "sms", m.blast_id ? smsNames.get(m.blast_id) : undefined, snippet(m.body) || "SMS campaign")),
  ];
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Plain-words reason a past sequence ended, for the History list. */
export function endedBecause(s: SubscribedSequence): string {
  if (s.stopReason === "replied") return "Stopped — the lead replied";
  if (s.stopReason === "suppressed") return "Stopped — unsubscribed or bounced";
  if (s.stopReason === "sequence_paused") return "Stopped — the sequence was paused";
  return s.status === "completed" ? "Finished all steps" : "Removed from the sequence";
}

/** Plain-words delivery state of a campaign message. */
export function campaignStatusLabel(status: string): string {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "sent":
    case "submitted":
      return "Sent";
    case "queued":
    case "sending":
    case "deferred":
      return "Waiting to send";
    case "suppressed":
      return "Not sent — unsubscribed";
    case "bounced":
      return "Bounced";
    case "complained":
      return "Marked as spam";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
