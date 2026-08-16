export type SmsErrorCode =
  | "insufficient_balance"
  | "invalid_token"
  | "no_valid_recipients"
  | "all_failed"
  | "rate_limited"
  | "network"
  | "unknown";

export interface SmsSendResultValid {
  id: string;
  mobile: string;
  credit: number;
  network: string;
  status: string;
  shortcode?: string | null;
}

export interface SmsSendResultInvalid {
  mobile: string;
  message: string;
}

export interface SmsSendResult {
  valid: SmsSendResultValid[];
  invalid: SmsSendResultInvalid[];
}

export type SmsSendOutcome =
  | { ok: true; result: SmsSendResult }
  | { ok: false; code: SmsErrorCode; message: string; retryable: boolean };

export interface ProviderReportRow {
  id: string;
  mobile: string;
  status: string;
  // Best-effort fields, not fully documented by Aakash — see
  // docs/SMS-PHASE1-BRIEF.md §2 for what preflight actually confirmed
  // (`id` has no relationship to the send response's id; `credit` is a
  // STRING; `updated_at` can be the MySQL zero-date "0000-00-00 00:00:00").
  // `message` (the rendered body) is used by delivery-match.ts as the second
  // half of its recipient+body match key when present; guard its absence.
  credit?: string;
  updated_at?: string;
  message?: string;
  [key: string]: unknown;
}

export interface SmsProvider {
  send(msg: { to: string[]; text: string }): Promise<SmsSendOutcome>;
  availableCredit(): Promise<number | null>;
  report(startDate: string, endDate: string): Promise<ProviderReportRow[]>;
}
