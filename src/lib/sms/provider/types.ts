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
  [key: string]: unknown;
}

export interface SmsProvider {
  send(msg: { to: string[]; text: string }): Promise<SmsSendOutcome>;
  availableCredit(): Promise<number | null>;
  report(startDate: string, endDate: string): Promise<ProviderReportRow[]>;
}
