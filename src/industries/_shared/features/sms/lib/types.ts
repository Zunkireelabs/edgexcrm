// Shared client-side row shapes mirroring migrations 202-204
// (supabase/migrations/202_sms_settings_and_credits.sql,
// 203_sms_messages_and_blasts.sql, 204_sms_suppressions_and_optout.sql).
// No `zod` here on purpose — these describe API-response shapes the UI
// trusts, not user input to validate.

import type { FilterTree } from "@/lib/filters/types";

export type SmsBlastStatus = "draft" | "scheduled" | "queued" | "sending" | "sent" | "partially_failed" | "failed" | "cancelled";

export interface SmsBlastRow {
  id: string;
  tenant_id: string;
  name: string;
  body: string;
  audience_filter: FilterTree | null;
  audience_snapshot_count: number | null;
  status: SmsBlastStatus;
  scheduled_for: string | null;
  estimated_credits: number | null;
  reserved_credits: number | null;
  actual_credits: number | null;
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

export type SmsMessageStatus = "queued" | "deferred" | "sending" | "submitted" | "delivered" | "failed" | "suppressed" | "cancelled";

export interface SmsMessageRow {
  id: string;
  blast_id: string | null;
  lead_id: string | null;
  to_phone: string;
  to_phone_stored: string | null;
  body: string;
  encoding: "gsm7" | "unicode" | null;
  segments: number | null;
  estimated_credits: number | null;
  status: SmsMessageStatus;
  provider_message_id: string | null;
  provider_credit: number | null;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface SmsPreviewResponse {
  audience: {
    matched: number;
    sendable: number;
    excluded: { noPhone: number; foreignNumber: number; malformed: number; suppressed: number; duplicatePhone: number };
  };
  message: {
    encoding: "gsm7" | "unicode";
    chars: number;
    segments: number;
    creditsPerRecipient: number;
    prefix: string;
    footer: string;
    overheadChars: number;
    personalized: boolean;
  };
  cost: { totalCredits: number; balance: number; balanceAfter: number; sufficient: boolean; shortfall: number };
  timing: { willSendAt: string; deferredByQuietHours: boolean; localTimeLabel: string };
  samples: string[];
}

export interface SmsCreditAccount {
  tenant_id: string;
  balance: number;
  reserved: number;
  lifetime_granted: number;
  lifetime_consumed: number;
  updated_at: string;
}

export interface SmsCreditLedgerRow {
  id: string;
  delta: number;
  reason: "grant" | "reserve" | "settle" | "settle_overage" | "refund" | "adjustment" | "reconcile_note";
  balance_after: number;
  ref_type: string | null;
  ref_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface SmsSuppressionRow {
  id: string;
  phone_e164: string;
  reason: "opt_out" | "manual" | "hard_bounce" | "complaint" | "invalid";
  source: string | null;
  lead_id: string | null;
  note: string | null;
  created_at: string;
}

export interface SmsSettings {
  sender_label: string | null;
  quiet_hours_start: number;
  quiet_hours_end: number;
  quiet_hours_enabled: boolean;
  timezone: string | null;
  optout_footer: string | null;
  max_recipients_per_blast: number;
  low_credit_threshold: number;
}
