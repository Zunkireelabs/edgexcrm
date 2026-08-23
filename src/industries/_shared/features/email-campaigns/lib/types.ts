// Shared client-side row shapes mirroring migration 212
// (supabase/migrations/212_email_blasts.sql) and the email_messages table
// from migration 211. No `zod` here on purpose — these describe API-response
// shapes the UI trusts, not user input to validate. Mirrors
// src/industries/_shared/features/sms/lib/types.ts.

import type { FilterTree } from "@/lib/filters/types";

export type EmailBlastStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "sending"
  | "throttled"
  | "sent"
  | "partially_failed"
  | "failed"
  | "cancelled";

export interface EmailBlastRow {
  id: string;
  tenant_id: string;
  name: string;
  subject_template: string;
  body_template: string;
  from_name_override: string | null;
  audience_filter: FilterTree | null;
  audience_snapshot_count: number | null;
  status: EmailBlastStatus;
  scheduled_for: string | null;
  recipients_total: number;
  recipients_sent: number;
  recipients_failed: number;
  recipients_suppressed: number;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EmailMessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed" | "bounced" | "complained" | "cancelled";

// Row shape returned by GET /api/v1/email-blasts/[id]/messages — a narrower
// projection than the full email_messages row.
export interface EmailBlastRecipientRow {
  id: string;
  lead_id: string | null;
  to_email: string;
  status: EmailMessageStatus;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
}

export interface EmailBlastPreviewResponse {
  audience: {
    matched: number;
    sendable: number;
    excluded: { noEmail: number; malformed: number; suppressed: number; duplicateEmail: number };
  };
  message: { personalized: boolean };
  sender: { from: string; replyTo: string | null };
  cap: { dailyCap: number; sentToday: number; remaining: number; overCapBy: number; willThrottle: boolean };
  samples: { subject: string; bodyHtml: string }[];
}

export interface EmailBlastAudienceCountResponse {
  matched: number;
  sendable: number;
  excluded: { noEmail: number; malformed: number; suppressed: number; duplicateEmail: number };
  sampleNames: string[];
}

export interface EmailBlastAudiencePreviewRow {
  leadId: string;
  name: string;
  email: string;
  source: string | null;
}

export interface EmailBlastAudiencePreviewResponse {
  rows: EmailBlastAudiencePreviewRow[];
  page: number;
  pageSize: number;
  total: number;
}
